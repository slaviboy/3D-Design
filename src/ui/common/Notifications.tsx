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
