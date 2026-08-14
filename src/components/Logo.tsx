import { Link } from '@/i18n/navigation';

export function Logo() {
  return (
    <Link aria-label="IngreFit home" className="logo" href="/">
      <span className="logo-mark">if</span>
      <span>IngreFit</span>
    </Link>
  );
}
