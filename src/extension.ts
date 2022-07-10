import * as vscode from "vscode";
import { JumpNet } from "./JumpNet";

let jumpNet: JumpNet;

export function activate(context: vscode.ExtensionContext) {
  jumpNet = new JumpNet(context);
  jumpNet.activate();
}

export function deactivate() {
  jumpNet.deactivate();
}
