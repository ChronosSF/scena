"use client";
// Loads the studio in the browser only. `ssr: false` keeps every module of the studio out of
// the server's render: its store opens saved work from localStorage as the module loads.
import dynamic from "next/dynamic";
import styles from "./studio.module.css";

const MountedStudio = dynamic(() => import("./MountedStudio.tsx"), {
  ssr: false,
  loading: () => <p className={styles.opening} role="status">Opening the studio…</p>,
});

export function StudioLoader() {
  return <MountedStudio />;
}
