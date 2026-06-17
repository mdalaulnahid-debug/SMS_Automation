package com.smsgateway

import android.os.Bundle
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.DividerItemDecoration
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.smsgateway.databinding.ActivityLogBinding
import com.smsgateway.databinding.ItemLogBinding
import com.smsgateway.db.AppDatabase
import com.smsgateway.db.LogEntry
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class LogActivity : AppCompatActivity() {
    private lateinit var binding: ActivityLogBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLogBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        BottomNavHelper.setup(this, binding.bottomNav, NavDestination.LOGS)

        val adapter = LogAdapter()
        binding.recyclerView.apply {
            layoutManager = LinearLayoutManager(this@LogActivity)
            addItemDecoration(DividerItemDecoration(context, DividerItemDecoration.VERTICAL))
            this.adapter = adapter
        }

        lifecycleScope.launch {
            AppDatabase.get(this@LogActivity).logDao().getRecent().collectLatest {
                adapter.submitList(it)
            }
        }
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }
}

private class LogAdapter : RecyclerView.Adapter<LogAdapter.VH>() {
    private var items: List<LogEntry> = emptyList()
    private val fmt = SimpleDateFormat("MM-dd HH:mm:ss", Locale.getDefault())

    fun submitList(list: List<LogEntry>) {
        items = list
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(ItemLogBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) =
        holder.bind(items[position], fmt)

    override fun getItemCount() = items.size

    class VH(private val b: ItemLogBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(entry: LogEntry, fmt: SimpleDateFormat) {
            b.tvTime.text = fmt.format(Date(entry.timestamp))
            b.tvType.text = entry.type
            b.tvDirection.text = if (entry.direction == "OUTBOUND") "→ OUT" else "← IN"
            val party = entry.recipient ?: entry.sender ?: ""
            b.tvParty.text = party
            b.tvMessage.text = entry.messageBody.take(80)
            b.tvStatus.text = entry.status
            b.tvStatus.setTextColor(
                b.root.context.getColor(
                    when (entry.status) {
                        "OK" -> R.color.success
                        "FAILED" -> R.color.danger
                        else -> R.color.warning
                    }
                )
            )
        }
    }
}
