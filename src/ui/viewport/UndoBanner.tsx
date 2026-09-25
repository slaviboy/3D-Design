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

import { useEffect, useState } from 'react';
import { useEditorState } from '../EditorContext';

/** How long the notice stays after the last undo or redo, in milliseconds. */
const VISIBLE_MS = 1400;

/**
 * Names what an undo or redo took back or brought back, at the top of the view, whether it came from a gesture, a
 * key or a menu. Holding fingers to undo quickly keeps it up, updated with each step.
 */
export function UndoBanner() {
  const notice = useEditorState((state) => state.historyNotice);
  const [shownSerial, setShownSerial] = useState<number | null>(null);

  useEffect(() => {
    if (!notice) return;
    setShownSerial(notice.serial);
    const timer = window.setTimeout(() => {
      setShownSerial(null);
    }, VISIBLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  const visible = notice !== null && shownSerial === notice.serial;
  return (
    <div className="undo-banner" role="status" aria-live="polite" data-visible={visible}>
      {visible && `${notice.kind === 'undo' ? 'Undo' : 'Redo'} ${notice.label}`}
    </div>
  );
}
