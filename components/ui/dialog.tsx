"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;

export function DialogContent({ children, labelledBy }: { children: React.ReactNode; labelledBy: string }) {
  return (
    <>
      <DialogPrimitive.Overlay className="sheet-backdrop" />
      <DialogPrimitive.Content className="bottom-sheet" aria-labelledby={labelledBy}>{children}</DialogPrimitive.Content>
    </>
  );
}
