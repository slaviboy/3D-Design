import { useEffect, useState } from 'react';
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

function setStartScreenEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.removeItem(START_SCREEN_PREFERENCE_KEY);
    else window.localStorage.setItem(START_SCREEN_PREFERENCE_KEY, 'hidden');
  } catch {
    // Without storage the choice lasts only for this session.
  }
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
                {file.name}
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
