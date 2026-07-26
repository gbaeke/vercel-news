'use client';

import type { ButtonHTMLAttributes } from 'react';
import { useFormStatus } from 'react-dom';

interface SubmitButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  label: string;
  pendingLabel: string;
}

/**
 * A submit control must be rendered inside its form for useFormStatus to
 * observe that form's server action.
 */
export function SubmitButton({
  label,
  pendingLabel,
  className = 'btn',
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      {...props}
      type="submit"
      className={className}
      disabled={disabled || pending}
      aria-busy={pending}
    >
      {pending && <span className="btn-spinner" aria-hidden="true" />}
      <span aria-live="polite">{pending ? pendingLabel : label}</span>
    </button>
  );
}
