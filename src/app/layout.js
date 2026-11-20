import "./globals.css";

export const metadata = {
  title: "Exam Seating Portal",
  description: "Exam seating arrangement and live timing dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
