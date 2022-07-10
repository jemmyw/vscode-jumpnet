// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from "fs/promises";
import path from "path";
import * as vscode from "vscode";
import { ThrottledAction } from "./ThrottledAction";
import { verticesByWeight } from "./util";
import { Vertex, WeightedGraph } from "./WeightedGraph";

const SCHEMA_VERSION = "1.0";

class RelatedTreeFile {
  constructor(public uri: vscode.Uri) {}
}

class RelatedTreeDataProvider
  implements vscode.TreeDataProvider<RelatedTreeFile>
{
  constructor(private jumpnet: JumpNet) {
    jumpnet.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this._onDidChangeTreeData.fire();
      })
    );
  }

  private _onDidChangeTreeData: vscode.EventEmitter<undefined | null | void> =
    new vscode.EventEmitter<undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<undefined | null | void> =
    this._onDidChangeTreeData.event;

  getTreeItem(
    element: RelatedTreeFile
  ): vscode.TreeItem | Thenable<vscode.TreeItem> {
    const { uri } = element;
    const relativePath = vscode.workspace.asRelativePath(uri);

    return {
      id: uri.fsPath,
      resourceUri: uri,
      description: path.dirname(relativePath),
      command: { title: "Open", command: "vscode.open", arguments: [uri] },
    };
  }
  getChildren(
    element?: RelatedTreeFile | undefined
  ): vscode.ProviderResult<RelatedTreeFile[]> {
    if (element) return [];

    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri) return [];

    const related = this.jumpnet.relatedFiles(uri, 50);

    return related.map((uri) => {
      return new RelatedTreeFile(uri);
    });
  }
}

class FileVertex implements Vertex {
  id: string;
  uri: any;

  constructor(uri: vscode.Uri) {
    this.id = vscode.workspace.asRelativePath(uri);
    this.uri = uri.toJSON();
  }
}

class JumpNet {
  jumpGraph = new WeightedGraph<FileVertex>();
  currentUri: vscode.Uri | null = null;
  // Do not record relations. Used to prevent recording when jumping to related
  ignoreOpen = false;
  // Save at most every 10s
  saveAction = new ThrottledAction(() => this.save(), { rateMs: 10000 });

  constructor(public context: vscode.ExtensionContext) {}

  async activate() {
    try {
      await this.load();
    } catch (err) {
      console.log("Could not load jump net:", err);
      console.log("starting with fresh data");
      this.jumpGraph = new WeightedGraph<FileVertex>();
    }

    this.saveAction.on("onError", (err) => {
      console.error("Saving jump graph failed:", err);
    });

    ["onVertexAdded", "onEdgeAdded"].forEach((event) =>
      this.jumpGraph.on(event, () => this.saveAction.queue())
    );

    if (vscode.window.activeTextEditor) {
      this.currentUri = vscode.window.activeTextEditor.document.uri;
      this.addFile(this.currentUri);
    }

    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.changedActiveFile(editor?.document?.uri);
      }),
      vscode.commands.registerCommand("jumpnet.related", () =>
        this.relatedCommand()
      ),
      vscode.window.registerTreeDataProvider(
        "jumpnet.relatedTree",
        new RelatedTreeDataProvider(this)
      )
    );
  }

  async deactivate() {
    await new Promise<void>((resolve) => {
      this.saveAction.once("onAfterRun", () => {
        this.saveAction.disarm();
        resolve();
      });
      this.saveAction.run();
    });
  }

  addFile(uri: vscode.Uri) {
    const vertex = new FileVertex(uri);
    this.jumpGraph.addVertex(vertex);
    return vertex;
  }

  addRelated(fromUri: vscode.Uri, toUri: vscode.Uri) {
    this.jumpGraph.addToEdge(this.addFile(fromUri), this.addFile(toUri), 1);
  }

  changedActiveFile(uri?: vscode.Uri) {
    if (!uri) {
      return;
    }

    if (this.ignoreOpen) return;

    if (this.currentUri) {
      this.addRelated(this.currentUri, uri);
    }

    this.currentUri = uri;
  }

  relatedFiles(uri: vscode.Uri, maxItems: number = 10) {
    const items: vscode.Uri[] = [];

    for (const related of verticesByWeight(
      this.jumpGraph,
      new FileVertex(uri)
    )) {
      items.push(vscode.Uri.from(related.uri));
      if (items.length >= maxItems) break;
    }

    return items;
  }

  async relatedCommand() {
    if (!vscode.window.activeTextEditor) return;

    const uris = this.relatedFiles(
      vscode.window.activeTextEditor.document.uri,
      10
    );
    const items: vscode.QuickPickItem[] = uris.map((uri) => ({
      label: uri.fsPath,
    }));

    const item = await vscode.window.showQuickPick(items, {});
    if (!item) return;
    const uri = uris.find((uri) => uri.fsPath === item.label);
    if (!uri) return;

    this.ignoreOpen = true;

    return vscode.workspace
      .openTextDocument(uri.fsPath)
      .then(vscode.window.showTextDocument)
      .then(() => (this.ignoreOpen = false));
  }

  storagePath() {
    const storageUri = this.context.storageUri;
    if (!storageUri) throw new Error("No storage uri");

    let workspaceName = vscode.workspace.name;
    if (!workspaceName && vscode.workspace.workspaceFolders) {
      if (vscode.workspace.workspaceFolders[0]) {
        workspaceName = vscode.workspace.workspaceFolders[0].name;
      }
    }
    if (!workspaceName) {
      throw new Error("No workspace name");
    }

    return path.join(
      storageUri.fsPath,
      workspaceName.replace(path.delimiter, "-") + ".json"
    );
  }

  async load() {
    const filePath = this.storagePath();
    const data = JSON.parse(await fs.readFile(filePath, { encoding: "utf-8" }));
    if (data.version !== SCHEMA_VERSION)
      throw new Error("Invalid data version");
    this.jumpGraph = WeightedGraph.fromJSON(data);
    console.log("loaded jumpnet from", filePath);
  }

  async save() {
    const filePath = this.storagePath();

    try {
      const dirStat = await fs.stat(path.dirname(filePath));
      if (!dirStat.isDirectory())
        throw new Error(
          `Storage path is not a directory ${path.dirname(filePath)}`
        );
    } catch (err) {
      await fs.mkdir(path.dirname(filePath));
    }

    console.log("writing to", filePath);

    const data = this.jumpGraph.toJSON() as any;
    data.version = SCHEMA_VERSION;

    await fs.writeFile(filePath, JSON.stringify(data), {
      encoding: "utf-8",
    });
  }
}

let jumpNet: JumpNet;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  jumpNet = new JumpNet(context);
  jumpNet.activate();
}

// this method is called when your extension is deactivated
export function deactivate() {
  jumpNet.deactivate();
}
