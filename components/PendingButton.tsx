"use client";

import React, { useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Wallet } from "lucide-react";

type PendingButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  children?: ReactNode;
  pending?: boolean;
  pendingLabel: string;
  onAction?: () => Promise<void>;
};

export function PendingButton({
  children,
  pending = false,
  pendingLabel,
  onAction,
  disabled,
  ...props
}: PendingButtonProps) {
  const [actionPending, setActionPending] = useState(false);
  const isPending = pending || actionPending;

  async function handleClick() {
    if (!onAction || isPending) return;
    setActionPending(true);
    try {
      await onAction();
    } finally {
      setActionPending(false);
    }
  }

  return (
    <button
      {...props}
      disabled={disabled || isPending}
      aria-busy={isPending}
      onClick={onAction ? handleClick : undefined}
    >
      <span className={isPending ? "pending-button-content pending" : "pending-button-content"}>
        <span className="pending-button-idle">{children}</span>
        <span className="pending-button-status" role="status" aria-live="polite">
          {isPending ? <><Wallet className="brand-loader" size={16} aria-hidden="true" /> {pendingLabel}</> : null}
        </span>
      </span>
    </button>
  );
}

export function usePendingAction() {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  async function run(action: () => Promise<void>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return { pending, run };
}
