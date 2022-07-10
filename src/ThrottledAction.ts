import EventEmitter from "events";

type Callback = () => void | Promise<void>;

interface ThrottledActionOptions {
  rateMs: number;
}

export class ThrottledAction extends EventEmitter {
  private timeout: NodeJS.Timeout | null = null;
  private running = false;
  private _lastError: any = null;
  private disarmed = false;

  constructor(
    private callback: Callback,
    private options: ThrottledActionOptions
  ) {
    super();
  }

  queue() {
    if (this.timeout) return;
    this.timeout = setTimeout(() => this.run(), this.options.rateMs);
    this.emit("onQueue");
  }

  get lastError() {
    return this._lastError;
  }

  disarm() {
    this.disarmed = true;
  }

  async run() {
    if (this.disarmed) return;
    if (this.running) {
      this.queue();
      return;
    }
    this.running = true;

    try {
      this.emit("onBeforeRun");
      await this.callback();
    } catch (err) {
      this._lastError = err;
      this.emit("onError", err);
    }

    this.emit("onAfterRun");
    this.running = false;
  }
}
