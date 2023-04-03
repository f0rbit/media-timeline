import type { AppProps } from "next/app";
import { SessionProvider } from "next-auth/react"

import "@/styles/global.css";
import { Session } from "next-auth";


export default function App({
  Component,
  pageProps: { session, ...pageProps },
}: { Component: any, pageProps: AppProps & { session: Session } }) {
  return (
    <SessionProvider session={session}>
      <Component {...pageProps} />
    </SessionProvider>
  )
}