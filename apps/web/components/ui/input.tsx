import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'block w-full min-h-11 rounded-lg border border-line bg-white px-3 py-2 text-base text-navy placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-surface aria-[invalid=true]:border-danger',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn('block w-full min-h-11 rounded-lg border border-line bg-white px-3 py-2 text-base text-navy focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20', className)}
    {...props}
  />
));
Select.displayName = 'Select';
