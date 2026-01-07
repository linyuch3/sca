/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);

  const { siteName } = useSite();

  // 在客户端挂载后设置配置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(storageType && storageType !== 'localstorage');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setRegisterSuccess(false);

    if (!password || (shouldAskUsername && !username)) return;

    // 注册模式的额外验证
    if (isRegisterMode) {
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致');
        return;
      }
      if (username.length < 3 || username.length > 20) {
        setError('用户名长度必须在3-20个字符之间');
        return;
      }
      if (password.length < 6) {
        setError('密码长度不能少于6个字符');
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        setError('用户名只能包含字母、数字和下划线');
        return;
      }
    }

    try {
      setLoading(true);
      
      if (isRegisterMode) {
        // 注册请求
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        if (res.ok) {
          setRegisterSuccess(true);
          setError(null);
          setPassword('');
          setConfirmPassword('');
          // 3秒后自动切换到登录模式
          setTimeout(() => {
            setIsRegisterMode(false);
            setRegisterSuccess(false);
          }, 3000);
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? '注册失败，请稍后重试');
        }
      } else {
        // 登录请求
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password,
            ...(shouldAskUsername ? { username } : {}),
          }),
        });

        if (res.ok) {
          // 记录登入时间（LunaTV 方式：前端调用 API 记录）
          const loginTime = Date.now();
          try {
            await fetch('/api/user/my-stats', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ loginTime })
            });
            // 更新 localStorage 记录
            localStorage.setItem('lastRecordedLogin', loginTime.toString());
          } catch (error) {
            console.log('记录登入时间失败:', error);
            // 登入时间记录失败不影响正常登录流程
          }

          const redirect = searchParams.get('redirect') || '/';
          router.replace(redirect);
        } else if (res.status === 401) {
          setError('密码错误');
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? '服务器错误');
        }
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };



  return (
    <div className='relative min-h-screen flex items-center justify-center px-4 overflow-hidden'>
      <div className='absolute top-4 right-4'>
        <ThemeToggle />
      </div>
      <div className='relative z-10 w-full max-w-md rounded-3xl bg-gradient-to-b from-white/90 via-white/70 to-white/40 dark:from-zinc-900/90 dark:via-zinc-900/70 dark:to-zinc-900/40 backdrop-blur-xl shadow-2xl p-10 dark:border dark:border-zinc-800'>
        <h1 className='text-green-600 tracking-tight text-center text-3xl font-extrabold mb-8 bg-clip-text drop-shadow-sm'>
          {siteName}
        </h1>
        
        {/* 模式切换提示 */}
        <div className='text-center mb-6'>
          <p className='text-sm text-gray-600 dark:text-gray-400'>
            {isRegisterMode ? '创建新账号' : '登录您的账号'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className='space-y-6'>
          {(shouldAskUsername || isRegisterMode) && (
            <div>
              <label htmlFor='username' className='sr-only'>
                用户名
              </label>
              <input
                id='username'
                type='text'
                autoComplete='username'
                className='block w-full rounded-lg border-0 py-3 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur'
                placeholder={isRegisterMode ? '输入用户名（3-20个字符）' : '输入用户名'}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          )}

          <div>
            <label htmlFor='password' className='sr-only'>
              密码
            </label>
            <input
              id='password'
              type='password'
              autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
              className='block w-full rounded-lg border-0 py-3 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur'
              placeholder={isRegisterMode ? '输入密码（至少6个字符）' : '输入访问密码'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {/* 注册模式下的确认密码 */}
          {isRegisterMode && (
            <div>
              <label htmlFor='confirmPassword' className='sr-only'>
                确认密码
              </label>
              <input
                id='confirmPassword'
                type='password'
                autoComplete='new-password'
                className='block w-full rounded-lg border-0 py-3 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur'
                placeholder='再次输入密码'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          )}

          {error && (
            <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
          )}

          {registerSuccess && (
            <p className='text-sm text-green-600 dark:text-green-400'>
              注册成功！即将跳转到登录...
            </p>
          )}

          {/* 提交按钮 */}
          <button
            type='submit'
            disabled={
              !password || 
              loading || 
              ((shouldAskUsername || isRegisterMode) && !username) ||
              (isRegisterMode && !confirmPassword)
            }
            className='inline-flex w-full justify-center rounded-lg bg-green-600 py-3 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {loading 
              ? (isRegisterMode ? '注册中...' : '登录中...') 
              : (isRegisterMode ? '注册' : '登录')
            }
          </button>

          {/* 模式切换链接 - 仅在需要用户名模式下显示 */}
          {shouldAskUsername && (
            <div className='text-center'>
              <button
                type='button'
                onClick={() => {
                  setIsRegisterMode(!isRegisterMode);
                  setError(null);
                  setPassword('');
                  setConfirmPassword('');
                  setRegisterSuccess(false);
                }}
                className='text-sm text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 transition-colors'
              >
                {isRegisterMode ? '已有账号？立即登录' : '没有账号？立即注册'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageClient />
    </Suspense>
  );
}
