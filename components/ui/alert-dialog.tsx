"use client";

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending = false,
  onOpenChange,
  onConfirm
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Overlay className="confirm-backdrop" />
      <AlertDialogPrimitive.Content className="confirm-dialog">
        <AlertDialogPrimitive.Title>{title}</AlertDialogPrimitive.Title>
        <AlertDialogPrimitive.Description>{description}</AlertDialogPrimitive.Description>
        <div className="confirm-dialog-actions">
          <AlertDialogPrimitive.Cancel asChild><Button variant="secondary">Cancel</Button></AlertDialogPrimitive.Cancel>
          <Button variant="destructive" disabled={pending} aria-busy={pending} onClick={onConfirm}>{pending ? pendingLabel : confirmLabel}</Button>
        </div>
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Root>
  );
}
