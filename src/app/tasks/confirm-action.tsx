"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BUTTON } from "./button-style";

type Props = {
  /** The server action to run once the user has confirmed. */
  action: (formData: FormData) => Promise<void>;
  /** Hidden form fields to send with it, for example the quest's id. */
  fields?: Record<string, string>;
  /** The visible text of the first button. */
  label: string;
  /**
   * The first button's spoken name for screen readers. It must START WITH `label` (WCAG 2.5.3,
   * "Label in Name"), so a voice-control user who says "click Delete forever" finds it.
   */
  accessibleLabel: string;
  /** What is about to happen, said plainly. Shown with the two choices. */
  question: string;
  /** The visible text of the button that goes ahead. */
  confirmLabel: string;
};

/**
 * A button for something that cannot be undone. The first click does NOT run the action: it asks
 * "are you sure?" with two choices, and only the confirming button submits. Focus goes to Cancel
 * (the harmless choice) when the question appears, and back to the first button if the user cancels,
 * so a keyboard user is never left stranded.
 */
export function ConfirmAction({
  action,
  fields = {},
  label,
  accessibleLabel,
  question,
  confirmLabel,
}: Props) {
  const [asking, setAsking] = useState(false);
  const questionId = useId();
  const askButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  // Only move focus after the user has acted, never on first load.
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    (asking ? cancelButton : askButton).current?.focus();
  }, [asking]);

  return (
    <form action={action}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {asking ? (
        <div role="group" aria-labelledby={questionId} className="flex flex-col gap-2">
          <p id={questionId} className="text-sm font-bold">
            {question}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={BUTTON}>
              {confirmLabel}
            </button>
            <button
              ref={cancelButton}
              type="button"
              className={BUTTON}
              onClick={() => {
                moveFocus.current = true;
                setAsking(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={askButton}
          type="button"
          aria-label={accessibleLabel}
          className={BUTTON}
          onClick={() => {
            moveFocus.current = true;
            setAsking(true);
          }}
        >
          {label}
        </button>
      )}
    </form>
  );
}
