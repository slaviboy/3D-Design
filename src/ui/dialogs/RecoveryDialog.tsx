import type { RecoverySnapshot } from '../../io/idb/recovery';
import { Dialog } from '../common/Dialog';

interface RecoveryDialogProps {
  readonly snapshots: readonly RecoverySnapshot[];
  readonly onRestore: (snapshot: RecoverySnapshot) => void;
  readonly onDiscard: (snapshot: RecoverySnapshot) => void;
  readonly onClose: () => void;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function RecoveryDialog({ snapshots, onRestore, onDiscard, onClose }: RecoveryDialogProps) {
  return (
    <Dialog title="Recover unsaved work" onClose={onClose}>
      <h2 className="dialog__title">Recover unsaved work</h2>
      <p className="dialog__text">
        Planar found work that wasn&apos;t saved when a previous session ended. It is stored only on this
        device.
      </p>
      <ul className="recovery-list">
        {snapshots.map((snapshot) => (
          <li className="recovery-list__item" key={snapshot.id}>
            <div>
              <div className="recovery-list__name">{snapshot.documentName}</div>
              <div className="recovery-list__time">{timeFormat.format(snapshot.savedAt)}</div>
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
      <div className="dialog__footer">
        <button type="button" className="button" onClick={onClose}>
          Decide later
        </button>
      </div>
    </Dialog>
  );
}
