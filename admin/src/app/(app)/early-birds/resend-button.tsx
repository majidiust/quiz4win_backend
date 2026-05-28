"use client";

import { useState } from "react";
import { Mail, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resendWelcomeEmail } from "@/lib/actions/early-birds";
import { toast } from "sonner";

export function ResendEmailButton({ birdId, hasSent }: { birdId: string, hasSent: boolean }) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleResend() {
    setLoading(true);
    try {
      await resendWelcomeEmail(birdId);
      setSuccess(true);
      toast.success("Welcome email sent successfully");
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={handleResend}
      disabled={loading || success}
      title={hasSent ? "Resend welcome email" : "Send welcome email"}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : success ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <Mail className={`h-4 w-4 ${hasSent ? "text-muted-foreground" : "text-primary"}`} />
      )}
    </Button>
  );
}
