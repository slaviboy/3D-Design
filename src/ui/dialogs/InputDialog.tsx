import { useId, useState } from 'react';
import type { InputRequest } from '../../app/Editor';
import { Dialog } from '../common/Dialog';
import { useEditor } from '../EditorContext';

/** Asks the user for one value on behalf of the editor (for example, how many segments to divide an edge into). */
export function InputDialog({ request }: { readonly request: InputRequest }) {
  const editor = useEditor();
  const [value, setValue] = useState(request.initial);
  const inputId = useId();
  const cancel = () => {
    editor.resolveInput(null);
  };

  return (
    <Dialog title={request.title} onClose={cancel}>
      <h2 className="dialog__title">{request.title}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          editor.resolveInput(value);
        }}
      >
        <div className="input-dialog__field">
          <label htmlFor={inputId}>{request.label}</label>
          <input
            id={inputId}
            className="input-dialog__input"
            value={value}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setValue(event.currentTarget.value);
            }}
          />
        </div>
        <div className="dialog__footer">
          <button type="button" className="button" onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="button button--primary">
            {request.confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
