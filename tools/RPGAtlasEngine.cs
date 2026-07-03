/* RPGAtlas engine launcher. GPL-3.0-or-later (see LICENSE).

   Double-clicking RPGAtlas.exe boots the Vite dev server for the engine
   folder and opens the editor in the default browser.

   Since the Phase 1 module build, index.html loads the editor runtime as
   <script type="module" src="/src/editor/main.ts"> — raw TypeScript that only
   Vite can transpile and serve. A plain static file server (what this
   launcher used to be) hands the browser an unexecutable .ts file and the
   editor never boots, so the launcher now requires Node.js plus an installed
   node_modules (npm install) and delegates serving to Vite.

   Browser opening is delegated to Vite's --open flag: Vite only opens once
   the server is actually accepting connections, which avoids any launcher-
   side readiness polling (a hand-rolled TCP probe here previously mis-
   handled IPv6 localhost and delayed the browser by up to a minute).
   --clearScreen false keeps the RPGAtlas banner visible above Vite's own
   output so first-time users always see the URL and how to stop. */
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;

internal static class RPGAtlasEngine
{
    private const int FirstPort = 8080;
    private const int LastPort = 8099;

    private static int Main(string[] args)
    {
        Console.Title = "RPGAtlas";
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        bool openBrowser = Array.IndexOf(args, "--no-browser") < 0;

        if (!File.Exists(Path.Combine(root, "index.html")))
        {
            return Fail(
                "RPGAtlas could not find index.html next to this program.",
                "Keep RPGAtlas.exe inside the RPGAtlas folder, then run it again.");
        }

        string viteScript = Path.Combine(root, "node_modules", "vite", "bin", "vite.js");
        if (!File.Exists(viteScript))
        {
            return Fail(
                "RPGAtlas needs its one-time setup first.",
                "Open a terminal in the RPGAtlas folder and run:  npm install");
        }

        int port = FindFreePort();
        if (port == 0)
        {
            return Fail(
                "RPGAtlas could not find a free local port (" + FirstPort + "-" + LastPort + ").",
                "Close any other copy of RPGAtlas that may already be running, then try again.");
        }

        string url = "http://localhost:" + port + "/";
        Console.WriteLine();
        Console.WriteLine("  RPGAtlas is starting...");
        Console.WriteLine();
        Console.WriteLine("  Editor:  " + url);
        Console.WriteLine("  Player:  " + url + "play.html");
        Console.WriteLine();
        Console.WriteLine("  Your browser will open by itself in a moment.");
        Console.WriteLine("  Keep this window open while you work. Close it to stop RPGAtlas.");
        Console.WriteLine();

        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = "node";
        startInfo.Arguments = "\"" + viteScript + "\" --port " + port + " --strictPort --clearScreen false"
            + (openBrowser ? " --open" : "");
        startInfo.WorkingDirectory = root;
        startInfo.UseShellExecute = false;

        Process vite;
        try
        {
            vite = Process.Start(startInfo);
        }
        catch (Exception)
        {
            return Fail(
                "RPGAtlas could not start Node.js (is it installed?).",
                "Install Node.js 18 or newer from https://nodejs.org/ and try again.");
        }

        // Vite shares this console, so closing the window shuts both down.
        vite.WaitForExit();

        if (vite.ExitCode != 0)
        {
            return Fail(
                "RPGAtlas stopped because of an error (see the messages above).",
                "If you are stuck, ask for help and share a photo of this window.");
        }
        return 0;
    }

    private static int FindFreePort()
    {
        for (int candidate = FirstPort; candidate <= LastPort; candidate++)
        {
            try
            {
                TcpListener probe = new TcpListener(System.Net.IPAddress.Loopback, candidate);
                probe.Start();
                probe.Stop();
                return candidate;
            }
            catch (SocketException) { /* port busy — try the next one */ }
        }
        return 0;
    }

    private static int Fail(string problem, string advice)
    {
        Console.WriteLine();
        Console.WriteLine("  " + problem);
        Console.WriteLine("  " + advice);
        Console.WriteLine();
        Console.WriteLine("  Press Enter to close.");
        Console.ReadLine();
        return 1;
    }
}
