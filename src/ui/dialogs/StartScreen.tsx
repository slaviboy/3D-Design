import { useEffect, useMemo, useState } from 'react';
import { TEMPLATES } from '../../app/templates/templates';
import type { RecentFile, RecentFilesRepository } from '../../io/idb/recent';
import { Dialog } from '../common/Dialog';
import { useEditor } from '../EditorContext';

export const START_SCREEN_PREFERENCE_KEY = 'planar.startScreen';

/** Whether the start screen opens when Planar starts. Defaults to yes when storage can't be read. */
export function startScreenEnabled(): boolean {
  try {
    return window.localStorage.getItem(START_SCREEN_PREFERENCE_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

export function setStartScreenEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.removeItem(START_SCREEN_PREFERENCE_KEY);
    else window.localStorage.setItem(START_SCREEN_PREFERENCE_KEY, 'hidden');
  } catch {
    // Without storage the choice lasts only for this session.
  }
}

/** A recent file's stored preview. Decorative: the file name next to it is the button's label. */
function RecentThumbnail({ bytes }: { readonly bytes: Uint8Array }) {
  const url = useMemo(
    () => URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' })),
    [bytes],
  );
  useEffect(
    () => () => {
      URL.revokeObjectURL(url);
    },
    [url],
  );
  return <img className="start-screen__thumbnail" src={url} alt="" width={96} height={72} />;
}

/** Templates, Open and recent files, shown when Planar starts and from File > Start Screen. */
export function StartScreen({
  recent,
  onClose,
}: {
  readonly recent?: RecentFilesRepository;
  readonly onClose: () => void;
}) {
  const editor = useEditor();
  const [files, setFiles] = useState<readonly RecentFile[]>([]);
  const [showAtStartup, setShowAtStartup] = useState(startScreenEnabled);

  useEffect(() => {
    if (!recent) return;
    recent.list().then(setFiles, () => {
      setFiles([]);
    });
  }, [recent]);

  const run = (action: () => Promise<unknown>) => {
    onClose();
    void action();
  };

  return (
    <Dialog title="Start" onClose={onClose} className="start-screen">
      <h2 className="dialog__title">Start a model</h2>
      <div className="start-screen__templates" role="group" aria-label="Templates">
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className="start-screen__template"
            onClick={() => {
              run(() => editor.newFromTemplate(template.id));
            }}
          >
            <span className="start-screen__template-name">{template.name}</span>
            <span className="start-screen__template-description">{template.description}</span>
          </button>
        ))}
      </div>
      <h3 className="start-screen__heading">Recent files</h3>
      {files.length === 0 ? (
        <p className="dialog__text">Files you open or save appear here.</p>
      ) : (
        <ul className="start-screen__recent">
          {files.map((file) => (
            <li key={file.name}>
              <button
                type="button"
                className="start-screen__recent-file"
                disabled={file.handle === null}
                title={file.handle === null ? 'Reopen this file with Open…' : undefined}
                onClick={() => {
                  run(() => editor.openRecent(file.name, file.handle));
                }}
              >
                {file.thumbnail ? (
                  <RecentThumbnail bytes={file.thumbnail} />
                ) : (
                  <span
                    className="start-screen__thumbnail start-screen__thumbnail--empty"
                    aria-hidden="true"
                  />
                )}
                <span className="start-screen__recent-name">{file.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog__footer start-screen__footer">
        <label className="start-screen__startup">
          <input
            type="checkbox"
            checked={showAtStartup}
            onChange={(event) => {
              setShowAtStartup(event.currentTarget.checked);
              setStartScreenEnabled(event.currentTarget.checked);
            }}
          />
          Show at startup
        </label>
        {editor.hasFileAccess && (
          <button
            type="button"
            className="button"
            onClick={() => {
              run(() => editor.openFile());
            }}
          >
            Open…
          </button>
        )}
        <button type="button" className="button button--primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
