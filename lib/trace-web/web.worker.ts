import { workerCore, type BuildRequest } from "./worker-core"

/**
 * THE TRACE WEB'S WORKER. Ticket `0259`. Everything it does is `worker-core.ts`; this is the
 * message loop. Typed structurally: the project's `lib` is the DOM's, where `self.postMessage`
 * has the window's signature, not a worker's.
 */
const scope = self as unknown as {
  onmessage: ((event: { data: BuildRequest }) => void) | null
  postMessage(message: unknown, transfer: ArrayBuffer[]): void
}
const handle = workerCore()
scope.onmessage = (event) => {
  const { response, transfer } = handle(event.data)
  scope.postMessage(response, transfer)
}
