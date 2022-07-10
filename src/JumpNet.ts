import * as fs from "fs/promises";
import path from "path";
import * as vscode from "vscode";
import { RelatedTreeDataProvider } from "./RelatedTreeView";
import { ThrottledAction } from "./ThrottledAction";
import { verticesByWeight } from "./util";
import { Vertex, WeightedGraph } from "./WeightedGraph";

export const SCHEMA_VERSION = "1.0";

export class FileVertex implements Vertex {
  id: string;
  uri: any;

  constructor(uri: vscode.Uri) {
    this.id = vscode.workspace.asRelativePath(uri);
    this.uri = uri.toJSON();
  }
}

export class JumpNet {
  jumpGraph = new WeightedGraph<FileVertex>();
  currentUri: vscode.Uri | null = null;
  // Do not record relations. Used to prevent recording when jumping to related
  ignoreOpen = false;
  // Save at most every 10s
  saveAction = new ThrottledAction(() => this.save(), { rateMs: 10000 });
  private relatedTreeProvider = new RelatedTreeDataProvider(this);

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
      vscode.commands.registerCommand("jumpnet.reset", () =>
        this.resetCommand()
      ),
      vscode.window.registerTreeDataProvider(
        "jumpnet.relatedTree",
        this.relatedTreeProvider
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

  async resetCommand() {
    const action = await vscode.window.showInformationMessage(
      "Clear all JumpNet relations?",
      "Yes",
      "No"
    );
    if (action !== "Yes") return;

    this.jumpGraph = new WeightedGraph<FileVertex>();
    this.saveAction.run();
    this.relatedTreeProvider.reset();
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
