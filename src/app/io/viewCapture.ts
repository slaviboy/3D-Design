/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * The port the editor uses to render the view to an image. The render layer implements it (Viewport.capture) and the
 * UI attaches the live viewport to a relay, so the application layer never touches WebGL.
 */

export interface ImageCaptureOptions {
  readonly width: number;
  readonly height: number;
  readonly transparentBackground: boolean;
}

export type CaptureFunction = (options: ImageCaptureOptions) => Promise<Blob>;

export interface ViewCapturePort {
  /** Whether a view is attached and can be captured now. */
  readonly available: boolean;
  capture(options: ImageCaptureOptions): Promise<Blob>;
}

/** Largest image edge the exporter asks for, in pixels. */
export const MAX_IMAGE_EDGE = 8192;

/** Forwards captures to whichever view is attached. */
export class ViewCaptureRelay implements ViewCapturePort {
  #source: CaptureFunction | null = null;

  /** Attaches a view. Returns a function that detaches it again. */
  attach(source: CaptureFunction): () => void {
    this.#source = source;
    return () => {
      if (this.#source === source) this.#source = null;
    };
  }

  get available(): boolean {
    return this.#source !== null;
  }

  capture(options: ImageCaptureOptions): Promise<Blob> {
    const source = this.#source;
    return source ? source(options) : Promise.reject(new Error('The 3D view is not available'));
  }
}
