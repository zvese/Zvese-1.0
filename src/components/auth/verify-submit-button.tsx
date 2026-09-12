"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

interface VerifySubmitButtonProps
  extends React.ComponentProps<typeof Button> {
  pendingText: string;
}

export function VerifySubmitButton({
  pendingText,
  children,
  ...props
}: VerifySubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}