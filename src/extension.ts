// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from "fs/promises";
import path from "path";
import * as vscode from "vscode";
import { ThrottledAction } from "./ThrottledAction";
import { verticesByWeight } from "./util";
import { deserialize, serialize, Vertex, WeightedGraph } from "./WeightedGraph";

class GraphProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext<unknown>,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    console.log("bah");
  }
}

class FileVertex implements Vertex {
  id: string;
  fsPath: string;

  constructor(uri: vscode.Uri) {
    this.id = vscode.workspace.asRelativePath(uri);
    this.fsPath = uri.fsPath;
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
      vscode.window.registerWebviewViewProvider(
        "jumpnet.graph",
        new GraphProvider(),
        {
          webviewOptions: {},
        }
      )
    );
  }

  deactivate() {}

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

  async relatedCommand() {
    if (!vscode.window.activeTextEditor) return;
    const uri = vscode.window.activeTextEditor.document.uri;
    const items: vscode.QuickPickItem[] = [];
    const maxItems = 10;

    for (const related of verticesByWeight(
      this.jumpGraph,
      new FileVertex(uri)
    )) {
      items.push({
        label: related.id,
      });
      if (items.length >= maxItems) break;
    }

    const item = await vscode.window.showQuickPick(items, {});
    if (!item) return;
    const vertex = this.jumpGraph.getVertex(item.label);
    if (!vertex) return;

    this.ignoreOpen = true;

    return vscode.workspace
      .openTextDocument(vertex.fsPath)
      .then(vscode.window.showTextDocument)
      .then(() => (this.ignoreOpen = false));
  }

  storagePath() {
    const storageUri = this.context.storageUri;
    if (!storageUri) throw new Error("No storage uri");

    const data = serialize(this.jumpGraph);
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
    const data = await fs.readFile(filePath, { encoding: "utf-8" });
    this.jumpGraph = deserialize(data);
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
    await fs.writeFile(filePath, serialize(this.jumpGraph), {
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
