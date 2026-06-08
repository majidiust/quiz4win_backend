/**
 * Sound usage slots — shared constants/types for the Sounds feature.
 *
 * Kept in a plain (non-"use server") module so it can be imported by both
 * server actions and client components. A "use server" file may only export
 * async functions, so these value exports must live here.
 */

export type SoundUsage =
  | "splash"
  | "home"
  | "home_before_start"
  | "register"
  | "game_details"
  | "correct_answer"
  | "incorrect_answer"
  | "countdown"
  | "pregame_music"
  | "winner"
  | "announcement"
  | "livestream";

export const SOUND_USAGES: { value: SoundUsage; label: string }[] = [
  { value: "splash",            label: "Splash Screen" },
  { value: "home",              label: "Home" },
  { value: "home_before_start", label: "Home — Before Start" },
  { value: "register",          label: "Registration" },
  { value: "game_details",      label: "Game Details" },
  { value: "correct_answer",    label: "Correct Answer" },
  { value: "incorrect_answer",  label: "Incorrect Answer" },
  { value: "countdown",         label: "Countdown" },
  { value: "pregame_music",     label: "Pre-game Music" },
  { value: "winner",            label: "Winner" },
  { value: "announcement",      label: "Announcement" },
  { value: "livestream",        label: "Livestream" },
];
