import { useEffect } from 'react';
import { useEditor, useEditorState } from '../EditorContext';

/** Information messages disappear after this long; errors stay until dismissed. */
const INFO_TIMEOUT_MS = 4000;

export function Notifications() {
  const editor = useEditor();
  const notifications = useEditorState((state) => state.notifications);

  useEffect(() => {
    const timers = notifications
      .filter((notification) => notification.kind === 'info')
      .map((notification) =>
        setTimeout(() => {
          editor.dismissNotification(notification.id);
        }, INFO_TIMEOUT_MS),
      );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [editor, notifications]);

  return (
    <div className="notifications" aria-live="polite">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`notification notification--${notification.kind}`}
          role={notification.kind === 'error' ? 'alert' : 'status'}
        >
          <span>{notification.message}</span>
          <button
            type="button"
            className="notification__close"
            aria-label="Dismiss"
            onClick={() => {
              editor.dismissNotification(notification.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
