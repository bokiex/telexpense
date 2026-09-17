"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

export function Switch(props: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return <SwitchPrimitive.Root className="ui-switch" {...props}><SwitchPrimitive.Thumb className="ui-switch-thumb" /></SwitchPrimitive.Root>;
}
