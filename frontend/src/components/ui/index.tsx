/**
 * UI Component Library
 * Dark Industrial / Sci-Fi Design System
 * 
 * Uses Phosphor icons via Iconify for consistent iconography
 */

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode, useState, useRef, useEffect, Children, isValidElement } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import { AnimatePresence, motion } from 'framer-motion';

// =============================================================================
// ICON COMPONENT - Wrapper for Iconify/Phosphor icons
// =============================================================================

interface IconProps {
  /** Phosphor icon name (e.g., 'ph:door-open', 'ph:stop-fill') */
  name: string;
  className?: string;
  size?: number | string;
}

export function PhIcon({ name, className = '', size = 24 }: IconProps) {
  return <Icon icon={name} className={className} width={size} height={size} />;
}

// =============================================================================
// STATUS LIGHT - Animated status indicator
// =============================================================================

type StatusVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface StatusLightProps {
  variant?: StatusVariant;
  pulse?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const statusColors: Record<StatusVariant, string> = {
  success: '#00ff9d',
  warning: '#ffaa00',
  danger: '#ff2a2a',
  info: '#00d2ff',
  neutral: '#666666',
};

const statusGlows: Record<StatusVariant, string> = {
  success: '0 0 12px #00ff9d',
  warning: '0 0 12px #ffaa00',
  danger: '0 0 12px #ff2a2a',
  info: '0 0 12px #00d2ff',
  neutral: '0 0 6px #666',
};

const statusSizes: Record<'sm' | 'md' | 'lg', number> = {
  sm: 8,
  md: 12,
  lg: 16,
};

export function StatusLight({ variant = 'success', pulse = false, size = 'md', className = '' }: StatusLightProps) {
  return (
    <span
      className={`inline-block rounded-full ${pulse ? 'animate-pulse' : ''} ${className}`}
      style={{
        width: statusSizes[size],
        height: statusSizes[size],
        backgroundColor: statusColors[variant],
        boxShadow: statusGlows[variant],
      }}
    />
  );
}

// =============================================================================
// BUTTON - Primary interactive element
// =============================================================================

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  children?: ReactNode;
}

const buttonVariants: Record<ButtonVariant, { base: string; hover: string }> = {
  primary: {
    base: 'bg-[#ffaa00]/10 text-[#ffaa00] border-[#ffaa00]/30',
    hover: 'hover:bg-[#ffaa00]/30 hover:border-[#ffaa00]/70 hover:shadow-[0_0_25px_rgba(255,170,0,0.3)]',
  },
  secondary: {
    base: 'bg-[#00d2ff]/10 text-[#00d2ff] border-[#00d2ff]/30',
    hover: 'hover:bg-[#00d2ff]/30 hover:border-[#00d2ff]/70 hover:shadow-[0_0_25px_rgba(0,210,255,0.3)]',
  },
  danger: {
    base: 'bg-[#ff2a2a]/10 text-[#ff2a2a] border-[#ff2a2a]/30',
    hover: 'hover:bg-[#ff2a2a]/30 hover:border-[#ff2a2a]/70 hover:shadow-[0_0_25px_rgba(255,42,42,0.3)]',
  },
  success: {
    base: 'bg-[#00ff9d]/10 text-[#00ff9d] border-[#00ff9d]/30',
    hover: 'hover:bg-[#00ff9d]/30 hover:border-[#00ff9d]/70 hover:shadow-[0_0_25px_rgba(0,255,157,0.3)]',
  },
  ghost: {
    base: 'bg-white/5 text-gray-300 border-white/10',
    hover: 'hover:bg-white/15 hover:text-white hover:border-white/30',
  },
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-6 py-3 text-base gap-2.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', icon, iconPosition = 'left', loading, children, className = '', disabled, ...props }, ref) => {
    const isDisabled = disabled || loading;
    const variantStyles = buttonVariants[variant];
    
    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={`
          inline-flex items-center justify-center
          font-mono tracking-wide
          border rounded-xl
          transition-all duration-200
          cursor-pointer
          active:scale-[0.98]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050508]
          disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
          ${variantStyles.base}
          ${variantStyles.hover}
          ${buttonSizes[size]}
          ${className}
        `}
        {...props}
      >
        {loading && <Icon icon="ph:spinner" className="animate-spin" width={16} height={16} />}
        {!loading && icon && iconPosition === 'left' && <Icon icon={icon} width={16} height={16} />}
        {children}
        {!loading && icon && iconPosition === 'right' && <Icon icon={icon} width={16} height={16} />}
      </button>
    );
  }
);
Button.displayName = 'Button';

// =============================================================================
// ICON BUTTON - Square button with just an icon
// =============================================================================

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  label: string; // Required for accessibility
  loading?: boolean;
}

const iconButtonSizes: Record<ButtonSize, string> = {
  sm: 'w-7 h-7',
  md: 'w-9 h-9',
  lg: 'w-11 h-11',
};

const iconSizes: Record<ButtonSize, number> = {
  sm: 14,
  md: 16,
  lg: 20,
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, variant = 'ghost', size = 'md', label, loading, className = '', disabled, ...props }, ref) => {
    const isDisabled = disabled || loading;
    const variantStyles = buttonVariants[variant];
    
    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-label={label}
        data-tooltip={label}
        className={`
          inline-flex items-center justify-center
          border rounded-lg
          transition-all duration-200
          cursor-pointer
          active:scale-[0.95]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050508]
          disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
          ${variantStyles.base}
          ${variantStyles.hover}
          ${iconButtonSizes[size]}
          ${className}
        `}
        {...props}
      >
        {loading ? (
          <Icon icon="ph:spinner" className="animate-spin" width={iconSizes[size]} height={iconSizes[size]} />
        ) : (
          <Icon icon={icon} width={iconSizes[size]} height={iconSizes[size]} />
        )}
      </button>
    );
  }
);
IconButton.displayName = 'IconButton';

// =============================================================================
// SELECT - Custom styled dropdown
// =============================================================================

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  error?: string;
  onChange?: (e: { target: { value: string } }) => void;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className = '', children, value, onChange, ...props }, ref) => {
    const [isOpen, setIsOpen] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, openUpward: false });
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Extract options from children
    const options = Children.toArray(children)
      .filter(isValidElement)
      .map((child: any) => ({ 
        value: child.props.value, 
        label: child.props.children 
      }));

    const selectedOption = options.find(opt => opt.value === value);

    // Estimate dropdown height (each option ~40px, max 320px)
    const estimatedDropdownHeight = Math.min(options.length * 40, 320);

    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        
        // Open upward if not enough space below and more space above
        const openUpward = spaceBelow < estimatedDropdownHeight && spaceAbove > spaceBelow;
        
        setCoords({
          // Use viewport coordinates for fixed positioning
          top: openUpward ? rect.top - estimatedDropdownHeight - 4 : rect.bottom + 4,
          left: rect.left,
          width: rect.width,
          openUpward,
        });
      }
    };

    useEffect(() => {
      if (isOpen) {
        updatePosition();
        window.addEventListener('resize', updatePosition);
        
        // Update position on scroll to keep dropdown anchored to button
        const handleScroll = () => {
          updatePosition();
        };
        window.addEventListener('scroll', handleScroll, true); // Use capture to catch all scrolls
        
        return () => {
          window.removeEventListener('resize', updatePosition);
          window.removeEventListener('scroll', handleScroll, true);
        };
      }
    }, [isOpen]);

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (
          containerRef.current && 
          !containerRef.current.contains(event.target as Node) &&
          !(event.target as Element).closest('.select-dropdown-portal')
        ) {
          setIsOpen(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
      <div className="w-full" ref={containerRef}>
        {label && (
          <label className="block text-xs font-mono text-gray-500 mb-1.5 uppercase tracking-wider">
            {label}
          </label>
        )}
        <div className="relative">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => {
              updatePosition();
              setIsOpen(!isOpen);
            }}
            className={`
              w-full flex items-center justify-between
              bg-[#1a1a24] border border-white/10 
              rounded-lg px-3 py-2.5
              text-white font-sans text-left
              cursor-pointer
              transition-all duration-200
              hover:border-white/20
              focus:outline-none focus:ring-2 focus:ring-[#00d2ff]/20
              disabled:opacity-50 disabled:cursor-not-allowed
              ${error ? 'border-[#ff2a2a]/50 focus:ring-[#ff2a2a]/20' : ''}
              ${isOpen ? 'border-[#00d2ff]/50 ring-2 ring-[#00d2ff]/20' : ''}
              ${className}
            `}
          >
            <span className="truncate">{selectedOption?.label || 'Select...'}</span>
            <Icon 
              icon="ph:caret-down" 
              width={16} 
              height={16} 
              className={`text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isOpen && createPortal(
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, y: coords.openUpward ? 10 : -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: coords.openUpward ? 10 : -10 }}
                transition={{ duration: 0.15 }}
                className="select-dropdown-portal fixed z-[9999] bg-[#1a1a24] border border-white/10 rounded-lg shadow-xl overflow-hidden max-h-80 overflow-y-auto"
                style={{
                  top: coords.top,
                  left: coords.left,
                  width: coords.width,
                }}
              >
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange?.({ target: { value: option.value } });
                      setIsOpen(false);
                    }}
                    className={`
                      w-full text-left px-3 py-2.5 text-sm transition-colors
                      ${option.value === value 
                        ? 'bg-secondary/10 text-secondary' 
                        : 'text-gray-300 hover:bg-white/5 hover:text-white'}
                    `}
                  >
                    {option.label}
                  </button>
                ))}
              </motion.div>
            </AnimatePresence>,
            document.body
          )}

          {/* Hidden native select for form compatibility if needed */}
          <select
            ref={ref}
            value={value}
            onChange={onChange as any}
            className="sr-only"
            {...props}
          >
            {children}
          </select>
        </div>
        {error && (
          <p className="mt-1 text-xs font-mono" style={{ color: '#ff2a2a' }}>{error}</p>
        )}
      </div>
    );
  }
);
Select.displayName = 'Select';

// =============================================================================
// INPUT - Text input field
// =============================================================================

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className = '', type = 'text', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-xs font-mono text-gray-500 mb-1.5 uppercase tracking-wider">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              <Icon icon={icon} width={16} height={16} />
            </div>
          )}
          <input
            ref={ref}
            type={type}
            className={`
              w-full
              bg-surfaceHighlight border border-white/10 
              rounded-lg px-3 py-2.5
              text-white placeholder-gray-600 font-sans
              transition-all duration-200
              hover:border-white/20
              focus:border-secondary/50 focus:outline-none focus:ring-2 focus:ring-secondary/20
              disabled:opacity-50 disabled:cursor-not-allowed
              ${icon ? 'pl-10' : ''}
              ${error ? 'border-danger/50 focus:border-danger/50 focus:ring-danger/20' : ''}
              ${className}
            `}
            {...props}
          />
        </div>
        {error && (
          <p className="mt-1 text-xs font-mono text-danger">{error}</p>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

// =============================================================================
// CHECKBOX - Custom styled checkbox
// =============================================================================

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, className = '', ...props }, ref) => {
    return (
      <label className={`inline-flex items-center gap-2.5 cursor-pointer group ${className}`}>
        <div className="relative">
          <input
            ref={ref}
            type="checkbox"
            className="peer sr-only"
            {...props}
          />
          <div className={`
            w-5 h-5 rounded
            bg-surfaceHighlight border border-white/20
            transition-all duration-200
            group-hover:border-white/30
            peer-focus-visible:ring-2 peer-focus-visible:ring-secondary/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background
            peer-checked:bg-secondary/20 peer-checked:border-secondary/50
            peer-disabled:opacity-50 peer-disabled:cursor-not-allowed
          `} />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 peer-checked:opacity-100 transition-opacity text-secondary">
            <Icon icon="ph:check-bold" width={14} height={14} />
          </div>
        </div>
        {label && (
          <span className="text-sm text-gray-300 group-hover:text-white transition-colors select-none">
            {label}
          </span>
        )}
      </label>
    );
  }
);
Checkbox.displayName = 'Checkbox';

// =============================================================================
// TOGGLE BUTTON - For action selection (open, close, stop, toggle)
// =============================================================================

interface ToggleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
}

export const ToggleButton = forwardRef<HTMLButtonElement, ToggleButtonProps>(
  ({ active = false, children, className = '', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={`
          px-3 py-1.5 rounded-lg text-sm font-mono uppercase tracking-wider
          transition-all duration-200
          cursor-pointer
          focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/50
          ${active
            ? 'bg-secondary/20 text-secondary border border-secondary/50 shadow-[0_0_10px_rgba(0,210,255,0.1)]'
            : 'bg-surfaceHighlight text-gray-400 border border-white/10 hover:border-white/20 hover:text-gray-300'
          }
          ${className}
        `}
        {...props}
      >
        {children}
      </button>
    );
  }
);
ToggleButton.displayName = 'ToggleButton';

// =============================================================================
// BADGE - Status/Label badges
// =============================================================================

type BadgeVariant = 'default' | 'primary' | 'secondary' | 'success' | 'danger' | 'warning';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const badgeVariants: Record<BadgeVariant, string> = {
  default: 'bg-surfaceHighlight text-gray-300 border-white/10',
  primary: 'bg-primary/20 text-primary border-primary/30',
  secondary: 'bg-secondary/20 text-secondary border-secondary/30',
  success: 'bg-success/20 text-success border-success/30',
  danger: 'bg-danger/20 text-danger border-danger/30',
  warning: 'bg-yellow-900/30 text-yellow-500 border-yellow-700/50',
};

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center
        px-2 py-1 
        text-xs font-mono uppercase tracking-wider
        border rounded-lg
        ${badgeVariants[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}

// =============================================================================
// MODAL BACKDROP - For modal dialogs
// =============================================================================

interface ModalBackdropProps {
  children: ReactNode;
  onClose?: () => void;
}

export function ModalBackdrop({ children, onClose }: ModalBackdropProps) {
  // Lock body scroll when modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

// =============================================================================
// MODAL PANEL - The actual modal content container (legacy - use Modal instead)
// =============================================================================

interface ModalPanelProps {
  children: ReactNode;
  className?: string;
}

export function ModalPanel({ children, className = '' }: ModalPanelProps) {
  return (
    <div 
      className={`
        glass-panel rounded-t-2xl sm:rounded-2xl 
        p-6 border-white/10 
        w-full sm:max-w-md 
        max-h-[85vh] sm:max-h-[90vh] overflow-y-auto 
        shadow-[0_0_50px_rgba(0,0,0,0.5)]
        animate-in fade-in slide-in-from-bottom-4 sm:slide-in-from-bottom-2
        duration-300
        ${className}
      `}
    >
      {children}
    </div>
  );
}

// =============================================================================
// MODAL - Unified modal component with bottom sheet on mobile
// =============================================================================

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  title?: string;
  className?: string;
}

export function Modal({ children, onClose, title, className = '' }: ModalProps) {
  // Lock body scroll when modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Desktop Modal */}
      <div className="hidden sm:flex absolute inset-0 items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={`
            glass-panel rounded-2xl p-6 border-white/10 
            w-full max-w-md max-h-[90vh] overflow-y-auto 
            shadow-[0_0_50px_rgba(0,0,0,0.5)]
            ${className}
          `}
        >
          {title && (
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-display font-bold text-white">{title}</h2>
              <IconButton
                onClick={onClose}
                icon="ph:x-bold"
                label="Close"
                className="text-gray-400 hover:text-white"
              />
            </div>
          )}
          {children}
        </motion.div>
      </div>
      
      {/* Mobile Bottom Sheet */}
      <motion.div 
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 100 || info.velocity.y > 500) {
            onClose();
          }
        }}
        className={`sm:hidden absolute bottom-0 left-0 right-0 glass-panel rounded-t-2xl border-t border-white/10 ${className}`}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        
        {/* Scrollable content */}
        <div className="px-6 pb-6 max-h-[80vh] overflow-y-auto">
          {title && (
            <h2 className="text-lg font-display font-bold text-white mb-4">{title}</h2>
          )}
          {children}
        </div>
        
        {/* Safe area padding */}
        <div className="h-safe-area-inset-bottom" />
      </motion.div>
    </div>,
    document.body
  );
}

// =============================================================================
// ACTION BUTTON - For gate control actions (open, close, stop, toggle)
// =============================================================================

type ActionType = 'open' | 'close' | 'stop' | 'toggle';

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  action: ActionType;
  loading?: boolean;
  fullWidth?: boolean;
  /** Progress 0-100 for fill effect during active operation */
  progress?: number;
  /** Whether this gate is currently active (opening/closing) */
  isActive?: boolean;
}

const actionConfig: Record<ActionType, { icon: string; label: string; colors: string }> = {
  open: {
    icon: 'ph:door-open-fill',
    label: 'OPEN',
    colors: 'bg-surfaceHighlight border-white/5 hover:bg-surfaceHighlight/80 hover:border-success/50 hover:text-success hover:shadow-[0_0_15px_rgba(0,255,157,0.1)]',
  },
  close: {
    icon: 'ph:door-fill',
    label: 'CLOSE',
    colors: 'bg-surfaceHighlight border-white/5 hover:bg-surfaceHighlight/80 hover:border-primary/50 hover:text-primary hover:shadow-[0_0_15px_rgba(255,170,0,0.1)]',
  },
  stop: {
    icon: 'ph:stop-fill',
    label: 'STOP',
    colors: 'bg-danger/10 border-danger/30 text-danger hover:bg-danger/20 hover:border-danger/60 hover:shadow-[0_0_20px_rgba(255,42,42,0.2)]',
  },
  toggle: {
    icon: 'ph:power-fill',
    label: 'TOGGLE',
    colors: 'bg-surfaceHighlight border-white/5 hover:bg-surfaceHighlight/80 hover:border-secondary/50 hover:text-secondary hover:shadow-[0_0_15px_rgba(0,210,255,0.1)]',
  },
};

const activeLabels: Record<ActionType, string> = {
  open: 'Opening...',
  close: 'Closing...',
  stop: 'Stopping...',
  toggle: 'Toggling...',
};

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  ({ action, loading, fullWidth, progress, isActive, className = '', disabled, ...props }, ref) => {
    const config = actionConfig[action];
    const showProgress = isActive && progress !== undefined && progress > 0;
    
    // Active colors for when progress is showing
    const activeColors: Record<ActionType, string> = {
      open: 'border-success/50 text-success',
      close: 'border-primary/50 text-primary',
      stop: 'border-danger/50 text-danger',
      toggle: 'border-secondary/50 text-secondary',
    };
    
    const progressColors: Record<ActionType, string> = {
      open: 'bg-success/30',
      close: 'bg-primary/30',
      stop: 'bg-danger/30',
      toggle: 'bg-secondary/30',
    };
    
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`
          relative overflow-hidden group/btn
          flex flex-col items-center justify-center gap-2
          p-4 rounded-lg border
          transition-all duration-200
          cursor-pointer
          active:scale-95
          focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/50
          disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
          ${showProgress ? activeColors[action] : config.colors}
          ${fullWidth ? 'col-span-2' : ''}
          ${className}
        `}
        {...props}
      >
        {/* Progress fill from bottom */}
        {showProgress && (
          <div 
            className={`absolute bottom-0 left-0 right-0 ${progressColors[action]} transition-all duration-100 ease-linear`}
            style={{ height: `${100 - progress}%` }}
          />
        )}
        
        <div className="relative z-10 flex flex-col items-center gap-2">
          {loading ? (
            <Icon icon="ph:spinner" className="w-6 h-6 animate-spin" />
          ) : (
            <Icon icon={config.icon} className="w-6 h-6 transition-transform group-hover/btn:scale-110 duration-300" />
          )}
          <span className="text-xs font-mono uppercase tracking-widest font-bold">
            {showProgress ? activeLabels[action] : config.label}
          </span>
        </div>
        
        {/* Button internal glow effect */}
        {!showProgress && (
          <div className="absolute inset-0 bg-gradient-to-t from-white/5 to-transparent opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none" />
        )}
      </button>
    );
  }
);
ActionButton.displayName = 'ActionButton';
