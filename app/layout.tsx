// app/layout.tsx
import "./globals.css";

export const metadata = {
  title: "Athlete Viewer",
  description: "Biomechanics analysis",
  icons: { icon: "/icons/baseball.ico" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://www.youtube-nocookie.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
        <link rel="dns-prefetch" href="https://www.youtube-nocookie.com" />
        <link rel="dns-prefetch" href="https://i.ytimg.com" />
      </head>
      <body style={{ background: "#0b1020", color: "#e2e8f0" }}>
        {children}
      </body>
    </html>
  );
}
