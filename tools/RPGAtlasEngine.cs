/* RPGAtlas engine launcher. GPL-3.0-or-later (see LICENSE).

   Double-clicking RPGAtlas.exe starts a tiny local web server that serves the
   engine folder and opens the editor in the default browser. No Python, no
   Node, no install, and no admin rights: HttpListener loopback prefixes
   (http://localhost:PORT/) are exempt from the Windows URL-ACL requirement.

   The editor needs a real HTTP origin for two reasons:
     * localStorage / autosave is blocked on file:// pages, and
     * custom-asset discovery does fetch("img/<type>/") and parses the
       directory listing (see js/assets.js), which file:// cannot provide.
   This server returns python-style directory listings so that discovery works
   exactly as it does under `python -m http.server`. */
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

internal static class RPGAtlasEngine
{
    private const int FirstPort = 8080;
    private const int LastPort = 8099;

    private static readonly Dictionary<string, string> MimeTypes =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { ".html", "text/html; charset=utf-8" },
        { ".htm",  "text/html; charset=utf-8" },
        { ".js",   "text/javascript; charset=utf-8" },
        { ".mjs",  "text/javascript; charset=utf-8" },
        { ".css",  "text/css; charset=utf-8" },
        { ".json", "application/json; charset=utf-8" },
        { ".svg",  "image/svg+xml" },
        { ".png",  "image/png" },
        { ".webp", "image/webp" },
        { ".jpg",  "image/jpeg" },
        { ".jpeg", "image/jpeg" },
        { ".gif",  "image/gif" },
        { ".ico",  "image/x-icon" },
        { ".wav",  "audio/wav" },
        { ".ogg",  "audio/ogg" },
        { ".mp3",  "audio/mpeg" },
        { ".txt",  "text/plain; charset=utf-8" },
        { ".md",   "text/plain; charset=utf-8" },
        { ".map",  "application/json; charset=utf-8" },
        { ".exe",  "application/octet-stream" },
    };

    private static string _root;

    private static int Main()
    {
        _root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);

        if (!File.Exists(Path.Combine(_root, "index.html")))
        {
            Console.WriteLine("RPGAtlas could not find index.html next to this program.");
            Console.WriteLine("Keep RPGAtlas.exe inside the RPGAtlas folder, then run it again.");
            Console.WriteLine();
            Console.WriteLine("Press Enter to close.");
            Console.ReadLine();
            return 1;
        }

        HttpListener listener = null;
        int port = 0;
        for (int candidate = FirstPort; candidate <= LastPort; candidate++)
        {
            try
            {
                HttpListener attempt = new HttpListener();
                attempt.Prefixes.Add("http://localhost:" + candidate + "/");
                attempt.Start();
                listener = attempt;
                port = candidate;
                break;
            }
            catch (HttpListenerException) { /* port busy — try the next one */ }
        }

        if (listener == null)
        {
            Console.WriteLine("RPGAtlas could not open a local port (" + FirstPort + "-" + LastPort + ").");
            Console.WriteLine("Close any other copy of RPGAtlas that may already be running, then try again.");
            Console.WriteLine();
            Console.WriteLine("Press Enter to close.");
            Console.ReadLine();
            return 1;
        }

        string url = "http://localhost:" + port + "/";

        Console.Title = "RPGAtlas";
        Console.WriteLine();
        Console.WriteLine("  RPGAtlas is running.");
        Console.WriteLine();
        Console.WriteLine("  Editor:  " + url);
        Console.WriteLine("  Player:  " + url + "play.html");
        Console.WriteLine();
        Console.WriteLine("  Your browser should open automatically.");
        Console.WriteLine("  Keep this window open while you work. Close it to stop RPGAtlas.");
        Console.WriteLine();

        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { Console.WriteLine("  (Open " + url + " in your browser to begin.)"); }

        while (listener.IsListening)
        {
            HttpListenerContext context;
            try { context = listener.GetContext(); }
            catch { break; }
            ThreadPool.QueueUserWorkItem(delegate { Handle(context); });
        }
        return 0;
    }

    private static void Handle(HttpListenerContext context)
    {
        try
        {
            string relative = Uri.UnescapeDataString(context.Request.Url.AbsolutePath).TrimStart('/');
            string fullPath = Path.GetFullPath(Path.Combine(_root, relative.Replace('/', Path.DirectorySeparatorChar)));

            // Refuse anything that escapes the engine folder.
            if (!fullPath.StartsWith(_root, StringComparison.OrdinalIgnoreCase))
            {
                WriteStatus(context, 403, "Forbidden");
                return;
            }

            if (Directory.Exists(fullPath))
            {
                string indexFile = Path.Combine(fullPath, "index.html");
                if (File.Exists(indexFile) && relative.Length == 0)
                {
                    ServeFile(context, indexFile);
                    return;
                }
                ServeDirectoryListing(context, fullPath);
                return;
            }

            if (File.Exists(fullPath))
            {
                ServeFile(context, fullPath);
                return;
            }

            WriteStatus(context, 404, "Not found");
        }
        catch
        {
            try { WriteStatus(context, 500, "Server error"); } catch { }
        }
    }

    private static void ServeFile(HttpListenerContext context, string path)
    {
        string ext = Path.GetExtension(path);
        string mime;
        if (!MimeTypes.TryGetValue(ext, out mime)) mime = "application/octet-stream";
        context.Response.ContentType = mime;
        context.Response.Headers["Cache-Control"] = "no-store";

        byte[] body = File.ReadAllBytes(path);
        context.Response.ContentLength64 = body.Length;
        context.Response.OutputStream.Write(body, 0, body.Length);
        context.Response.OutputStream.Close();
    }

    // Python-style directory listing: js/assets.js scans these <a href> links
    // to discover custom characters/facesets/enemies/tilesets.
    private static void ServeDirectoryListing(HttpListenerContext context, string directory)
    {
        StringBuilder html = new StringBuilder();
        html.Append("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>RPGAtlas</title></head><body><ul>");

        foreach (string dir in Directory.GetDirectories(directory))
        {
            string name = Path.GetFileName(dir);
            html.Append("<li><a href=\"" + Encode(name) + "/\">" + Encode(name) + "/</a></li>");
        }
        foreach (string file in Directory.GetFiles(directory))
        {
            string name = Path.GetFileName(file);
            html.Append("<li><a href=\"" + Encode(name) + "\">" + Encode(name) + "</a></li>");
        }
        html.Append("</ul></body></html>");

        byte[] body = Encoding.UTF8.GetBytes(html.ToString());
        context.Response.ContentType = "text/html; charset=utf-8";
        context.Response.ContentLength64 = body.Length;
        context.Response.OutputStream.Write(body, 0, body.Length);
        context.Response.OutputStream.Close();
    }

    private static void WriteStatus(HttpListenerContext context, int code, string message)
    {
        context.Response.StatusCode = code;
        byte[] body = Encoding.UTF8.GetBytes(message);
        context.Response.ContentType = "text/plain; charset=utf-8";
        context.Response.ContentLength64 = body.Length;
        context.Response.OutputStream.Write(body, 0, body.Length);
        context.Response.OutputStream.Close();
    }

    private static string Encode(string value)
    {
        return value
            .Replace("&", "&amp;")
            .Replace("\"", "&quot;")
            .Replace("<", "&lt;")
            .Replace(">", "&gt;");
    }
}
