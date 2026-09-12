"use client";
import dynamic from "next/dynamic";
const DemoApp = dynamic(() => import("../../frontend/src/DemoApp.jsx"), { ssr: false });
export default function Home() { return <DemoApp />; }
