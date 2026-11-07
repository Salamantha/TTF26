export const metadata = {
  title: "TTF Accessible Route Finder",
  description: "MCP server for accessible routing at the Salzburg Messe",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
