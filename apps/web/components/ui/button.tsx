import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const baseVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 min-h-11',
  {
    variants: {
      variant: {
        default: 'bg-brand text-white hover:bg-brand-dark',
        secondary: 'bg-white text-navy border border-line hover:bg-surface',
        ghost: 'text-navy hover:bg-surface',
        link: 'text-brand underline-offset-4 hover:underline min-h-0 px-0',
      },
      size: { default: 'px-4 py-2.5', lg: 'px-6 py-3 text-base', sm: 'px-3 py-2 min-h-9' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

/** Variantes fusionnées par tailwind-merge : une classe passée en paramètre remplace celle de la variante. */
export function buttonVariants(opts: VariantProps<typeof baseVariants> & { className?: string } = {}) {
  const { className, ...variants } = opts;
  return cn(baseVariants(variants), className);
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof baseVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';
