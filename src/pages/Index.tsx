import { Link } from "react-router-dom";

const Index = () => {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <section className="max-w-2xl mx-auto text-center px-6">
        <h1 className="text-4xl font-bold mb-4">Home Automation Control Panel</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Control devices, manage scenes, and monitor sensor events across multiple locations.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link to="/devices" className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-6 py-3 font-medium shadow-sm hover:opacity-90 transition">
            Go to Devices
          </Link>
          <Link to="/locations" className="inline-flex items-center justify-center rounded-md bg-secondary text-secondary-foreground px-6 py-3 font-medium shadow-sm hover:opacity-90 transition">
            Manage Locations
          </Link>
        </div>
      </section>
    </main>
  );
};

export default Index;
