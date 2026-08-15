import { Link } from '@/i18n/navigation';

export function Logo() {
  return (
    <Link aria-label="IngreFit home" className="logo" href="/">
      <img alt="" className="logo-image" height="36" src="/brand/icon.png" width="36" />
      <span>IngreFit</span>
    </Link>
  );
}
