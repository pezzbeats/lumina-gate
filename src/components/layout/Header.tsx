import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/devices", label: "Devices" },
  { to: "/events", label: "Events" },
  { to: "/scenes", label: "Scenes" },
  { to: "/locations", label: "Locations" },
  { to: "/settings", label: "Settings" },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <nav className="container flex h-14 items-center justify-between">
        <a href="/" className="font-semibold">Lumina Gate</a>
        <ul className="flex items-center gap-4 text-sm">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `px-3 py-2 rounded-md transition ${
                    isActive
                      ? "bg-secondary text-secondary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground"
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
