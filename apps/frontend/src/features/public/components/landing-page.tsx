import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { LogIn } from 'lucide-react';

interface LandingPageProps {
  onExplore: () => void;
  onLogin: () => void;
}

export function LandingPage({ onExplore, onLogin }: LandingPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasEl = canvas;

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      canvasEl.width = window.innerWidth;
      canvasEl.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Particle system
    class Particle {
      x: number;
      y: number;
      size: number;
      speedX: number;
      speedY: number;
      opacity: number;

      constructor() {
        this.x = Math.random() * canvasEl.width;
        this.y = Math.random() * canvasEl.height;
        this.size = Math.random() * 3 + 1;
        this.speedX = Math.random() * 0.5 - 0.25;
        this.speedY = Math.random() * 0.5 - 0.25;
        this.opacity = Math.random() * 0.3 + 0.1;
      }

      update() {
        this.x += this.speedX;
        this.y += this.speedY;

        if (this.x > canvasEl.width) this.x = 0;
        if (this.x < 0) this.x = canvasEl.width;
        if (this.y > canvasEl.height) this.y = 0;
        if (this.y < 0) this.y = canvasEl.height;
      }

      draw() {
        if (!ctx) return;
        ctx.fillStyle = `rgba(80, 158, 227, ${this.opacity})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Flow lines system
    class FlowLine {
      points: { x: number; y: number }[];
      offset: number;
      speed: number;
      amplitude: number;
      frequency: number;
      opacity: number;

      constructor(startY: number) {
        this.points = [];
        this.offset = Math.random() * Math.PI * 2;
        this.speed = Math.random() * 0.02 + 0.01;
        this.amplitude = Math.random() * 50 + 30;
        this.frequency = Math.random() * 0.01 + 0.005;
        this.opacity = Math.random() * 0.2 + 0.1;
        
        // Create initial points
        for (let x = 0; x <= canvasEl.width; x += 20) {
          this.points.push({
            x,
            y: startY + Math.sin(x * this.frequency + this.offset) * this.amplitude,
          });
        }
      }

      update() {
        this.offset += this.speed;
        this.points = [];
        for (let x = 0; x <= canvasEl.width; x += 20) {
          this.points.push({
            x,
            y: this.points[0]?.y || 0 + Math.sin(x * this.frequency + this.offset) * this.amplitude,
          });
        }
      }

      draw() {
        if (!ctx || this.points.length < 2) return;
        ctx.strokeStyle = `rgba(80, 158, 227, ${this.opacity})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(this.points[0].x, this.points[0].y);
        
        for (let i = 1; i < this.points.length; i++) {
          ctx.lineTo(this.points[i].x, this.points[i].y);
        }
        ctx.stroke();
      }
    }

    // Initialize particles and flow lines
    const particles: Particle[] = [];
    const flowLines: FlowLine[] = [];

    for (let i = 0; i < 50; i++) {
      particles.push(new Particle());
    }

    for (let i = 0; i < 8; i++) {
      flowLines.push(new FlowLine(Math.random() * canvasEl.height));
    }

    // Animation loop
    const animate = () => {
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

      // Draw flow lines
      flowLines.forEach(line => {
        line.update();
        line.draw();
      });

      // Draw particles
      particles.forEach(particle => {
        particle.update();
        particle.draw();
      });

      requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  return (
    <div className="relative min-h-screen bg-white overflow-hidden">
      {/* Animated Background */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ opacity: 0.6 }}
      />

      {/* Navigation Header */}
      <header className="relative z-10 px-8 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-foreground tracking-tight">ATMOS</h1>
          <p className="text-[9pt] font-light text-[#6B7280] mt-0.5">
            Environmental Research and Data Analytics Platform
          </p>
        </div>

        <Button
          variant="outline"
          onClick={onLogin}
          className="border-[#509EE3] text-[#509EE3] hover:bg-[#509EE3]/10"
        >
          <LogIn className="w-4 h-4 mr-2" />
          Login
        </Button>
      </header>

      {/* Hero Section */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-120px)] px-8">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          {/* Main Title */}
          <h2 className="text-5xl md:text-6xl lg:text-7xl font-bold text-foreground leading-tight">
            El Aire de Quito,
            <br />
            <span className="text-[#509EE3]">Visible para Todos</span>
          </h2>

          {/* Subtitle */}
          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto">
            Monitoreo científico y ciudadano de la atmósfera en tiempo real
          </p>

          {/* Primary CTA */}
          <div className="pt-8">
            <Button
              onClick={onExplore}
              className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white text-lg px-12 py-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
              size="lg"
            >
              Explorar
            </Button>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-16 max-w-3xl mx-auto">
            <div className="p-6 bg-white/80 backdrop-blur-sm rounded-xl border border-border shadow-sm">
              <div className="w-12 h-12 rounded-lg bg-[#509EE3]/10 flex items-center justify-center mb-4 mx-auto">
                <svg className="w-6 h-6 text-[#509EE3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
              </div>
              <h3 className="font-semibold text-foreground mb-2">Datos en Vivo</h3>
              <p className="text-sm text-muted-foreground">
                Mediciones actualizadas cada hora de 8 estaciones en Quito
              </p>
            </div>

            <div className="p-6 bg-white/80 backdrop-blur-sm rounded-xl border border-border shadow-sm">
              <div className="w-12 h-12 rounded-lg bg-[#509EE3]/10 flex items-center justify-center mb-4 mx-auto">
                <svg className="w-6 h-6 text-[#509EE3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="font-semibold text-foreground mb-2">Análisis Avanzado</h3>
              <p className="text-sm text-muted-foreground">
                Herramientas de visualización y modelado para investigadores
              </p>
            </div>

            <div className="p-6 bg-white/80 backdrop-blur-sm rounded-xl border border-border shadow-sm">
              <div className="w-12 h-12 rounded-lg bg-[#509EE3]/10 flex items-center justify-center mb-4 mx-auto">
                <svg className="w-6 h-6 text-[#509EE3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="font-semibold text-foreground mb-2">Ciencia Abierta</h3>
              <p className="text-sm text-muted-foreground">
                Datos públicos para comunidad académica y ciudadana
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 px-8 py-6 text-center">
        <p className="text-sm text-muted-foreground">
          Universidad de Las Américas (UDLA) - Investigación Ambiental
        </p>
      </footer>
    </div>
  );
}
