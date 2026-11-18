import Image from "next/image";
import Link from "next/link";
import { ProductCard } from "@/components/catalog/ProductCard";
import { getCatalog } from "@/lib/catalog";

const FILTERS = [
  { key: "semua", label: "Semua", href: "/" },
  { key: "digital", label: "Digital", href: "/?jenis=digital" },
  { key: "fisik", label: "Fisik", href: "/?jenis=fisik" },
] as const;

export default async function Beranda({ searchParams }: { searchParams: Promise<{ jenis?: string | string[] }> }) {
  const { jenis } = await searchParams;
  const active = jenis === "digital" || jenis === "fisik" ? jenis : "semua"; // nilai asing dianggap "Semua"
  const products = await getCatalog();
  const groups = [
    { key: "digital", title: "Digital", items: products.filter((p) => p.type === "digital") },
    { key: "fisik", title: "Fisik", items: products.filter((p) => p.type === "physical") },
  ].filter((g) => active === "semua" || g.key === active);
  let first = true; // gambar pertama dimuat segera (LCP), sisanya malas

  return (
    <>
      <section className="store-hero" aria-labelledby="store-title">
        <div className="hero-copy">
          <p className="eyebrow">Pilihan Hayatun</p>
          <h1 id="store-title">Ide baik.<br />Mulai dari sini.</h1>
          <p>E-book, template, aplikasi, dan produk pilihan untuk menemani belajar, berkarya, dan kebutuhan sehari-hari.</p>
          <Link href="#koleksi" className="btn" data-variant="primary">Jelajahi produk <span aria-hidden="true">↗</span></Link>
        </div>
        <div className="hero-image">
          <Image src="/ruang-kerja.jpg" alt="Buku catatan dan laptop di meja kerja yang diterangi cahaya alami" fill sizes="(min-width: 768px) 50vw, 100vw" quality={60} preload />
        </div>
      </section>
      <div className="collection-heading" id="koleksi">
        <h2>Temukan pilihanmu.</h2>
        <p className="meta">Produk digital dan fisik, dalam satu tempat.</p>
      </div>
      {products.length === 0 ? (
        <p className="empty">Produk Hayatun sedang disiapkan. Mampir lagi sebentar lagi ya.</p>
      ) : (
        <>
          <nav className="pills" aria-label="Jenis produk">
            {FILTERS.map((f) => (
              <Link key={f.key} href={f.href} className="pill" aria-current={f.key === active ? "page" : undefined}>{f.label}</Link>
            ))}
          </nav>
          {groups.map((g) => (
            <section key={g.key} className="catalog-group">
              <h2>{g.title}</h2>
              {g.items.length === 0 ? (
                <p className="empty">Belum ada produk {g.key}.</p>
              ) : (
                <ul className="catalog-grid" data-testid={`kelompok-${g.key}`}>
                  {g.items.map((p) => {
                    const priority = first;
                    first = false;
                    return <ProductCard key={p.id} p={p} priority={priority} />;
                  })}
                </ul>
              )}
            </section>
          ))}
        </>
      )}
    </>
  );
}
