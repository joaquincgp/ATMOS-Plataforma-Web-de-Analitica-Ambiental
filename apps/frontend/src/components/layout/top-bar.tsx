import { LogOut, User } from 'lucide-react';

interface TopBarProps {
  userName: string;
  onLogout: () => void;
}

export function TopBar({ userName, onLogout }: TopBarProps) {
  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-end px-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onLogout}
          className="p-2 hover:bg-secondary rounded-lg transition-colors"
          title="Cerrar sesión"
        >
          <LogOut className="w-5 h-5 text-foreground/70" />
        </button>
        <div className="flex items-center gap-2 pl-4 border-l border-border">
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="text-sm">{userName}</span>
        </div>
      </div>
    </header>
  );
}
