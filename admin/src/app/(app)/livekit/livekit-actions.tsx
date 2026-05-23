"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Circle, Square, Send, MicOff, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createRoom, deleteRoom, kickParticipant, muteParticipant,
  sendRoomData, startEgress, stopEgress,
} from "@/lib/actions/livekit";

/* ------------------------------------------------------------------ */
/* Create room dialog                                                   */
/* ------------------------------------------------------------------ */
export function CreateRoomDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [maxParticipants, setMax] = useState("");

  function submit() {
    if (!name.trim()) return toast.error("Room name required");
    start(async () => {
      const res = await createRoom({
        name: name.trim(),
        max_participants: maxParticipants ? parseInt(maxParticipants, 10) : undefined,
      });
      if (res.ok) { toast.success(res.message); setOpen(false); setName(""); setMax(""); router.refresh(); }
      else toast.error(res.message);
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" /> Create room</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create LiveKit room</DialogTitle>
            <DialogDescription>Provision an empty room on the LiveKit server.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="lk-name">Room name *</Label>
              <Input id="lk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="game-12345" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lk-max">Max participants</Label>
              <Input id="lk-max" type="number" min="1" value={maxParticipants} onChange={(e) => setMax(e.target.value)} placeholder="10000" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} onClick={submit}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* End room button */
export function EndRoomButton({ room }: { room: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function handle() {
    if (!confirm(`End room "${room}"? All participants will be disconnected.`)) return;
    start(async () => {
      const res = await deleteRoom(room);
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }
  return (
    <Button size="sm" variant="ghost" loading={pending} onClick={handle} className="h-7 text-destructive">
      <Trash2 className="size-3.5" /> End
    </Button>
  );
}

/* Start/Stop recording */
export function EgressToggleButton({ room, egressId }: { room: string; egressId?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isRecording = !!egressId;
  function handle() {
    start(async () => {
      const res = isRecording ? await stopEgress(egressId!) : await startEgress(room);
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }
  return (
    <Button size="sm" variant="ghost" loading={pending} onClick={handle} className="h-7">
      {isRecording ? <Square className="size-3.5 text-red-500" /> : <Circle className="size-3.5" />}
      {isRecording ? " Stop rec" : " Record"}
    </Button>
  );
}

/* Send data dialog */
export function SendDataDialog({ room }: { room: string }) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState("");
  const [pending, start] = useTransition();
  function submit() {
    if (!payload.trim()) return toast.error("Payload required");
    start(async () => {
      const res = await sendRoomData(room, payload);
      if (res.ok) { toast.success(res.message); setOpen(false); setPayload(""); }
      else toast.error(res.message);
    });
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Send className="size-3.5" /> Send data</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Send data to room</DialogTitle></DialogHeader>
          <Textarea value={payload} onChange={(e) => setPayload(e.target.value)} rows={4} placeholder='{"event":"announcement","text":"Hello"}' />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} onClick={submit}>Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* Kick participant */
export function KickParticipantButton({ room, identity }: { room: string; identity: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function handle() {
    if (!confirm(`Kick ${identity}?`)) return;
    start(async () => {
      const res = await kickParticipant(room, identity);
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }
  return (
    <Button size="icon" variant="ghost" loading={pending} onClick={handle} className="size-7 text-destructive">
      <UserMinus className="size-3.5" />
    </Button>
  );
}

/* Mute participant (per track) */
export function MuteTrackButton({ room, identity, trackSid, muted }: { room: string; identity: string; trackSid: string; muted: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function handle() {
    start(async () => {
      const res = await muteParticipant(room, identity, trackSid, !muted);
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }
  return (
    <Button size="icon" variant="ghost" loading={pending} onClick={handle} className="size-7">
      <MicOff className={`size-3.5 ${muted ? "text-red-500" : ""}`} />
    </Button>
  );
}
