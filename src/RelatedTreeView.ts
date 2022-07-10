import path from "path";
import * as vscode from "vscode";
import { JumpNet } from "./JumpNet";

class RelatedTreeFile {
  constructor(public uri: vscode.Uri) {}
}

export class RelatedTreeDataProvider
  implements vscode.TreeDataProvider<RelatedTreeFile>
{
  constructor(private jumpnet: JumpNet) {
    jumpnet.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.reset();
      })
    );
  }

  private _onDidChangeTreeData: vscode.EventEmitter<undefined | null | void> =
    new vscode.EventEmitter<undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<undefined | null | void> =
    this._onDidChangeTreeData.event;

  reset() {
    this._onDidChangeTreeData.fire();
  }

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
