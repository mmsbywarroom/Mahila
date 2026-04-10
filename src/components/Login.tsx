import { useState } from 'react';
import { authUrl, authHeadersJson, parseJsonResponse } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Phone, KeyRound } from 'lucide-react';

interface LoginProps {
  forceMode?: 'user' | 'admin';
}

export default function Login({ forceMode }: LoginProps) {
  const ADMIN_USER_ID = 'admin';
  const ADMIN_PASSWORD = 'admin@123';
  const [loginMode, setLoginMode] = useState<'user' | 'admin'>(forceMode ?? 'user');
  const [mobile, setMobile] = useState('');
  const [adminUserId, setAdminUserId] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [displayOtp, setDisplayOtp] = useState('');
  const [step, setStep] = useState<'register' | 'verify'>('register');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const hideModeToggle = Boolean(forceMode);

  const handleAdminLogin = () => {
    setError('');
    if (adminUserId === ADMIN_USER_ID && adminPassword === ADMIN_PASSWORD) {
      login({
        id: ADMIN_USER_ID,
        name: 'Admin',
        mobile: ADMIN_USER_ID,
        is_verified: true,
        role: 'admin',
      });
      return;
    }
    setError('Invalid admin credentials');
  };

  const handleSendOTP = async () => {
    if (!mobile) {
      setError('Please enter mobile number');
      return;
    }

    if (mobile.length !== 10) {
      setError('Mobile number must be 10 digits');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(authUrl('send-otp-login'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({ mobile }),
      });

      const data = await parseJsonResponse(response);

      if (data.success) {
        const code = data.otp != null && String(data.otp).length > 0 ? String(data.otp) : '';
        if (code) {
          setDisplayOtp(code);
          setOtp(code);
        } else {
          setDisplayOtp('');
          setOtp('');
        }
        setStep('verify');
      } else {
        setError(data.message || 'Failed to send OTP');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp) {
      setError('Please enter OTP');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(authUrl('verify-otp'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({ mobile, otp }),
      });

      const data = await parseJsonResponse(response);

      if (data.success) {
        login(data.user);
      } else {
        setError(data.message || 'Invalid OTP');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Women Registration Program</h1>
          <p className="text-gray-600">Sign in to continue</p>
        </div>

        {!hideModeToggle && (
          <div className="grid grid-cols-2 gap-2 mb-6 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => {
                setLoginMode('user');
                setError('');
              }}
              className={`py-2 rounded-md text-sm font-semibold transition-colors ${
                loginMode === 'user' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              User Login
            </button>
            <button
              onClick={() => {
                setLoginMode('admin');
                setError('');
                setStep('register');
              }}
              className={`py-2 rounded-md text-sm font-semibold transition-colors ${
                loginMode === 'admin' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Admin Login
            </button>
          </div>
        )}

        {loginMode === 'admin' ? (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">User ID</label>
              <input
                type="text"
                value={adminUserId}
                onChange={(e) => setAdminUserId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                placeholder="Enter admin user id"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                placeholder="Enter password"
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleAdminLogin}
              disabled={loading}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              Admin Login
            </button>
          </div>
        ) : step === 'register' ? (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mobile Number
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-3.5 h-5 w-5 text-gray-400" />
                <input
                  type="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                  placeholder="10 digit mobile number"
                  maxLength={10}
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleSendOTP}
              disabled={loading}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {loading ? 'Sending...' : 'Send OTP'}
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <p className="text-sm text-green-700 mb-2">OTP sent to {mobile}</p>
              {displayOtp ? (
                <p className="text-2xl font-bold text-green-800 tracking-wide">{displayOtp}</p>
              ) : (
                <p className="text-sm text-green-800">Use the code below when it appears.</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter OTP
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-3.5 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all text-center text-2xl tracking-widest"
                  placeholder="000000"
                  maxLength={6}
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleVerifyOTP}
              disabled={loading}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {loading ? 'Verifying...' : 'Verify & Login'}
            </button>

            <button
              onClick={() => {
                setStep('register');
                setOtp('');
                setDisplayOtp('');
                setError('');
              }}
              className="w-full text-gray-600 hover:text-gray-900 text-sm transition-colors"
            >
              Back to Registration
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
