"use client";

import { IconAlertTriangle as AlertTriangle } from "@tabler/icons-react";

export function ConflictWarning({ message }: { message: string }) {
  return (
    <p
      className="text-[10.5px] mt-1 inline-flex items-start gap-1"
      style={{ color: "var(--wp-rose)" }}
    >
      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
