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

import type { RecoverySnapshot } from '../../io/idb/recovery';
import { Dialog } from '../common/Dialog';

interface RecoveryDialogProps {
  readonly snapshots: readonly RecoverySnapshot[];
  readonly onRestore: (snapshot: RecoverySnapshot) => void;
  readonly onDiscard: (snapshot: RecoverySnapshot) => void;
  readonly onClose: () => void;
  readonly title?: string;
  readonly intro?: string;
  /** Shown instead of the list when there is nothing to offer. */
  readonly emptyText?: string;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const DEFAULT_TITLE = 'Recover unsaved work';
const DEFAULT_INTRO =
  "Planar found work that wasn't saved when a previous session ended. It is stored only on this device.";

/** Lists locally stored versions of models (autosaves or backups) with Restore and Discard actions. */
export function RecoveryDialog({
  snapshots,
  onRestore,
  onDiscard,
  onClose,
  title = DEFAULT_TITLE,
  intro = DEFAULT_INTRO,
  emptyText = '',
}: RecoveryDialogProps) {
  return (
    <Dialog title={title} onClose={onClose}>
      <h2 className="dialog__title">{title}</h2>
      <p className="dialog__text">{intro}</p>
      {snapshots.length === 0 ? (
        <p className="dialog__text">{emptyText}</p>
      ) : (
        <ul className="recovery-list">
          {snapshots.map((snapshot) => (
            <li className="recovery-list__item" key={snapshot.id}>
              <div>
                <div className="recovery-list__name">{snapshot.documentName}</div>
                <div className="recovery-list__time">
                  {snapshot.kind === 'backup' ? 'Saved version from ' : 'Autosaved '}
                  {timeFormat.format(snapshot.savedAt)}
                </div>
              </div>
              <div className="recovery-list__actions">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => {
                    onRestore(snapshot);
                  }}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    onDiscard(snapshot);
                  }}
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog__footer">
        <button type="button" className="button" onClick={onClose}>
          {title === DEFAULT_TITLE ? 'Decide later' : 'Close'}
        </button>
      </div>
    </Dialog>
  );
}
