import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { localWritesBlocked } from '@/lib/server/guard';

const execAsync = promisify(exec);

export const runtime = 'nodejs';

export async function POST(req: Request) {
  // Runs a process on the host — local-only, same switch as the config writers.
  const blocked = localWritesBlocked();
  if (blocked) return blocked;

  try {
    const { target } = await req.json();

    // For Claude Code, "claude doctor" tests the config validity without hanging.
    // For OpenCode, "opencode models" tests the connection and returns available models without hanging.
    const command = target === 'opencode' ? 'opencode models' : 'claude doctor';
    
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 15000 });
      return NextResponse.json({ success: true, output: (stdout || stderr).trim() });
    } catch (error: any) {
      // Handle command not found (ENOENT) specifically
      if (error.code === 'ENOENT') {
        const cliName = target === 'opencode' ? 'OpenCode (opencode)' : 'Claude Code (claude)';
        return NextResponse.json({ 
          success: false, 
          error: `${cliName} CLI not found in PATH. Install it first: ${target === 'opencode' ? 'npm i -g opencode' : 'See https://code.claude.com'}`,
          output: ''
        });
      }
      return NextResponse.json({ 
        success: false, 
        error: error.message, 
        output: (error.stdout?.toString() || error.stderr?.toString() || '').trim() 
      });
    }
  } catch (error: any) {
    return NextResponse.json({ 
      success: false, 
      error: error.message, 
      output: '' 
    });
  }
}
