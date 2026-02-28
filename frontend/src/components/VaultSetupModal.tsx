import React, { useState } from 'react';
import { Lock, Key, Shield, AlertCircle, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { vaultAPI } from '../services/api';
import { toast } from 'react-hot-toast';

interface VaultSetupModalProps {
  onComplete: () => void;
}

const VaultSetupModal: React.FC<VaultSetupModalProps> = ({ onComplete }) => {
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState({ score: 0, label: '', color: '' });

  const calculatePasswordStrength = (password: string) => {
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    let label = '';
    let color = '';
    if (score === 0) {
      label = '';
      color = '';
    } else if (score <= 2) {
      label = 'Weak';
      color = 'text-red-600';
    } else if (score === 3) {
      label = 'Fair';
      color = 'text-yellow-600';
    } else if (score === 4) {
      label = 'Good';
      color = 'text-blue-600';
    } else {
      label = 'Strong';
      color = 'text-green-600';
    }

    return { score, label, color };
  };

  const handlePasswordChange = (value: string) => {
    setMasterPassword(value);
    setPasswordStrength(calculatePasswordStrength(value));
  };

  const validatePassword = (password: string): { valid: boolean; error?: string } => {
    if (password.length < 8) {
      return { valid: false, error: 'Password must be at least 8 characters' };
    }
    if (!/[A-Z]/.test(password)) {
      return { valid: false, error: 'Password must contain at least 1 uppercase letter' };
    }
    if (!/[0-9]/.test(password)) {
      return { valid: false, error: 'Password must contain at least 1 number' };
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      return { valid: false, error: 'Password must contain at least 1 symbol' };
    }
    return { valid: true };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!understood) {
      toast.error('Please confirm that you understand the importance of the master password');
      return;
    }

    const validation = validatePassword(masterPassword);
    if (!validation.valid) {
      toast.error(validation.error!);
      return;
    }

    if (masterPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (passwordStrength.score < 3) {
      toast.error('Please use a stronger password (at least "Fair" strength)');
      return;
    }

    setIsSubmitting(true);
    try {
      await vaultAPI.initialize(masterPassword, confirmPassword);
      toast.success('Vault initialized successfully!');
      onComplete();
    } catch (error: any) {
      console.error('Failed to initialize vault:', error);
      toast.error(error.response?.data?.detail || 'Failed to initialize vault');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-5 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="bg-white p-2.5 rounded-full">
              <Shield className="w-7 h-7 text-purple-600" />
            </div>
            <div className="text-white">
              <h2 className="text-xl font-bold">Secure Your Vault</h2>
              <p className="text-sm text-purple-100">Master Password Setup</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-grow">
          {/* Information Box */}
          <div className="bg-blue-50 border-l-4 border-blue-500 p-3.5">
            <div className="flex">
              <Lock className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900">
                <p className="mb-2 font-medium">
                  Please set a master password for storing all future passwords.
                </p>
                <h3 className="font-semibold mb-1.5">What is the Master Vault Password?</h3>
                <p className="mb-1.5">
                  The Master Vault Password is used to encrypt and protect all repository passphrases 
                  for your managed clients. You'll need to enter it whenever deploying backups to clients.
                </p>
                <p className="font-medium">
                  Think of it like a "password manager" for your backup infrastructure.
                </p>
              </div>
            </div>
          </div>

          {/* Master Password Field */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Key className="inline w-4 h-4 mr-1" />
              Master Vault Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={masterPassword}
                onChange={(e) => handlePasswordChange(e.target.value)}
                className="block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                placeholder="Enter a strong master password"
                required
                disabled={isSubmitting}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {masterPassword && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-gray-600">Password Strength:</span>
                  <span className={`font-semibold ${passwordStrength.color}`}>
                    {passwordStrength.label}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-300 ${
                      passwordStrength.score <= 2
                        ? 'bg-red-500'
                        : passwordStrength.score === 3
                        ? 'bg-yellow-500'
                        : passwordStrength.score === 4
                        ? 'bg-blue-500'
                        : 'bg-green-500'
                    }`}
                    style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                  />
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-gray-500">
              <strong>Requirements:</strong> Minimum 8 characters, at least 1 uppercase letter, 1 number, and 1 symbol
            </p>
          </div>

          {/* Confirm Password Field */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Confirm Master Password
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              placeholder="Re-enter your master password"
              required
              disabled={isSubmitting}
            />
            {confirmPassword && masterPassword !== confirmPassword && (
              <p className="mt-2 text-sm text-red-600">Passwords do not match</p>
            )}
            {confirmPassword && masterPassword === confirmPassword && (
              <p className="mt-2 text-sm text-green-600 flex items-center">
                <CheckCircle className="w-4 h-4 mr-1" />
                Passwords match
              </p>
            )}
          </div>

          {/* Warning Box */}
          <div className="bg-red-50 border-l-4 border-red-500 p-3.5">
            <div className="flex">
              <AlertCircle className="w-5 h-5 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-900">
                <h3 className="font-semibold mb-1.5">⚠️ Critical Warning</h3>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>This password <strong>CANNOT be recovered</strong> if lost</li>
                  <li>Without it, you <strong>CANNOT access</strong> any stored client passphrases</li>
                  <li>You will need to enter it every time you deploy backups</li>
                  <li><strong>Store it securely</strong> (password manager, secure notes, etc.)</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Confirmation Checkbox */}
          <div className="flex items-start">
            <input
              type="checkbox"
              id="understood"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-1 h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
              disabled={isSubmitting}
            />
            <label htmlFor="understood" className="ml-3 text-sm text-gray-700">
              <span className="font-semibold">I understand</span> that losing this password means 
              losing access to all stored client passphrases, and I have stored it securely.
            </label>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end space-x-3 pt-3 border-t mt-4">
            <button
              type="submit"
              disabled={
                !masterPassword ||
                !confirmPassword ||
                masterPassword !== confirmPassword ||
                !understood ||
                passwordStrength.score < 3 ||
                isSubmitting
              }
              className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Initializing Vault...</span>
                </>
              ) : (
                <>
                  <Shield className="w-5 h-5" />
                  <span>Initialize Vault</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VaultSetupModal;

