import ShortenerForm from "@/components/shortener-form";

export default function Home() {
  return (
    <main className="flex min-h-screen w-full flex-col items-center px-4 py-12 sm:px-6 md:px-10 md:py-16 lg:px-0">
      <ShortenerForm />
    </main>
  );
}
