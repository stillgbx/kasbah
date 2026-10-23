package org.kasbah.auto

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/** The phone side: the server address and the sign-in. Everything else happens on the car screen. */
class MainActivity : Activity() {
    private lateinit var client: KasbahClient
    private var accesses: List<Access> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        client = KasbahClient(this)
        val url = findViewById<EditText>(R.id.url)
        val user = findViewById<EditText>(R.id.user)
        val password = findViewById<EditText>(R.id.password)
        val login = findViewById<Button>(R.id.login)
        val error = findViewById<TextView>(R.id.error)
        // A password field switches to a monospace font by itself.
        password.typeface = Typeface.DEFAULT

        url.setText(client.baseUrl)
        user.setText(client.account)
        render()
        // Asked here, phone in hand, rather than on the road from the car screen.
        val missing = FOREGROUND.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 0) else askBackgroundLocation()
        if (client.account.isNotEmpty()) placeGeofence()

        login.setOnClickListener {
            client.baseUrl = url.text.toString()
            login.isEnabled = false
            login.setText(R.string.signing_in)
            error.visibility = View.GONE
            val name = user.text.toString().trim()
            Background.run({
                client.login(name, password.text.toString())
                client.accesses() // proves the address and the session
                client.home = client.readHome()
            }) { result ->
                login.isEnabled = true
                login.setText(R.string.sign_in)
                password.text.clear()
                result.onSuccess { client.account = name; render(); Approach.register(this) }.onFailure {
                    error.text = it.message ?: getString(R.string.sign_in_failed)
                    error.visibility = View.VISIBLE
                }
            }
        }
        findViewById<Button>(R.id.switch_account).setOnClickListener {
            Approach.unregister(this)
            Background.run({ client.logout() }) { render() }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        if (requestCode == 0) askBackgroundLocation() else placeGeofence()
    }

    /**
     * The approach alert needs the location "all the time": asked on its own, after the location while
     * in use (Android shows it as a settings page), and after saying what it is for, as Google Play
     * requires of an app that reads the location in the background. Not asked again once refused.
     */
    private fun askBackgroundLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
        if (checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED) return
        AlertDialog.Builder(this)
            .setTitle(R.string.background_title)
            .setMessage(R.string.background_text)
            .setPositiveButton(R.string.background_continue) { _, _ -> requestPermissions(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), 1) }
            .setNegativeButton(R.string.background_no, null)
            .show()
    }

    /** The house's position read again (it may have moved in the editor), then the geofence around it. */
    private fun placeGeofence() {
        if (client.account.isEmpty()) return
        Background.run({ client.home = client.readHome() }) { Approach.register(this) }
    }

    private fun render() {
        val signedIn = client.account.isNotEmpty()
        findViewById<View>(R.id.form).visibility = if (signedIn) View.GONE else View.VISIBLE
        findViewById<View>(R.id.connected).visibility = if (signedIn) View.VISIBLE else View.GONE
        findViewById<TextView>(R.id.account).text = "${client.account} · ${Uri.parse(client.baseUrl).host ?: client.baseUrl}"
        accesses = emptyList()
        showAccesses()
        if (signedIn) Background.run({ client.accesses() }) { result -> result.onSuccess { accesses = it; showAccesses() } }
    }

    /** One row per access, in the car's order: its car name, its full name, ★ for the alert, ▲ ▼. */
    private fun showAccesses() {
        findViewById<View>(R.id.accesses_section).visibility = if (accesses.isEmpty()) View.GONE else View.VISIBLE
        val rows = findViewById<LinearLayout>(R.id.accesses)
        rows.removeAllViews()
        val chosen = chosenAlert()
        // None chosen: the alert takes the first two, shown with a muted star.
        val inAlert = alertAccesses(accesses, chosen).map { it.id }
        accesses.forEachIndexed { i, a ->
            val row = layoutInflater.inflate(R.layout.access_row, rows, false)
            row.findViewById<TextView>(R.id.label).text = a.label
            row.findViewById<TextView>(R.id.name).apply {
                text = a.name
                visibility = if (a.name == a.label) View.GONE else View.VISIBLE
            }
            row.findViewById<TextView>(R.id.star).apply {
                text = if (a.id in inAlert) "★" else "☆"
                setTextColor(getColor(if (a.id in chosen) R.color.accent else R.color.muted))
                setOnClickListener { toggleAlert(a) }
            }
            row.findViewById<View>(R.id.up).apply { enable(i > 0); setOnClickListener { move(i, -1) } }
            row.findViewById<View>(R.id.down).apply { enable(i < accesses.size - 1); setOnClickListener { move(i, 1) } }
            rows.addView(row)
        }
    }

    private fun View.enable(on: Boolean) {
        isEnabled = on
        alpha = if (on) 1f else 0.3f
    }

    /** The order numbers the accesses: saved at once, labels recomputed without asking the server. */
    private fun move(i: Int, by: Int) {
        val ids = accesses.map { it.id }.toMutableList()
        ids.add(i + by, ids.removeAt(i))
        client.order = ids
        accesses = client.arrange(accesses)
        showAccesses()
    }

    private fun toggleAlert(a: Access) {
        val chosen = chosenAlert().toMutableSet()
        when {
            a.id in chosen -> chosen -= a.id
            chosen.size >= 2 -> return Toast.makeText(this, R.string.accesses_two, Toast.LENGTH_SHORT).show()
            else -> chosen += a.id
        }
        client.alert = chosen
        showAccesses()
    }

    /** The alert's choice among the accesses still in the house. */
    private fun chosenAlert() = client.alert.filterTo(mutableSetOf()) { id -> accesses.any { it.id == id } }

    private companion object {
        val FOREGROUND = listOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.POST_NOTIFICATIONS,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        )
    }
}
