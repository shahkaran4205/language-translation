import "./globals.css";

export const metadata = {
  title: "Live Lingo",
  description: "Realtime speech translation"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
