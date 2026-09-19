// TaskScheduler: requestIdleCallback queue, timeout 3000, concurrency 1.

const TIMEOUT = 3e3;

function ensureIdleCallback() {
  if (typeof window === "undefined") return;
  // Install the idle callback polyfill on first construction instead of at import.
  window.requestIdleCallback =
    window.requestIdleCallback ||
    function (cb: IdleRequestCallback) {
      const start = Date.now();
      return setTimeout(() => {
        cb({
          didTimeout: false,
          timeRemaining: () => Math.max(0, TIMEOUT - (Date.now() - start)),
        });
      }, 1) as unknown as number;
    };
}

export class TaskScheduler {
  taskList: { task: () => void; resolve: () => void }[] = [];
  tasksCompleted = 0;
  currentTaskNumber = 0;
  taskHandle: number | null = null;
  maxConcurrency = 1;
  concurrency = 1;
  promises: Promise<void>[] = [];
  finished: Promise<void> | false = false;

  constructor() {
    ensureIdleCallback();
  }

  runTaskQueue = (deadline: IdleDeadline) => {
    while (
      (deadline.timeRemaining() > 0 || deadline.didTimeout) &&
      this.taskList.length &&
      this.currentTaskNumber - this.tasksCompleted < this.concurrency
    ) {
      const item = this.taskList.shift()!;
      this.currentTaskNumber += 1;
      item.task();
      item.resolve();
      this.tasksCompleted += 1;
    }
    if (this.taskList.length) this.taskHandle = requestIdleCallback(this.runTaskQueue, { timeout: TIMEOUT });
    else this.taskHandle = 0;
  };

  enqueueTask(task: () => void) {
    this.promises.push(
      new Promise<void>((resolve) => {
        this.taskList.push({ task, resolve });
      }),
    );
    if (!this.taskHandle) this.taskHandle = requestIdleCallback(this.runTaskQueue, { timeout: TIMEOUT });
  }

  get queueFinished(): Promise<void> {
    if (!this.finished)
      this.finished = new Promise<void>((resolve) => {
        Promise.all(this.promises).then(() => {
          this.finished = false;
          this.promises = [];
          resolve();
        });
      });
    return this.finished;
  }
}

export default TaskScheduler;
