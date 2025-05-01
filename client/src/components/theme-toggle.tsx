import { Moon, Sun } from "lucide-react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"

export function ThemeToggle() {
  const { setTheme, theme } = useTheme()

  // Toggle between light and dark mode only
  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark")
  }

  return (
    <motion.div
      whileTap={{ scale: 0.9 }}
      whileHover={{ scale: 1.1 }}
      initial={{ opacity: 0, rotate: -10 }}
      animate={{ opacity: 1, rotate: 0 }}
      transition={{ duration: 0.3, type: "spring", stiffness: 260, damping: 20 }}
    >
      <Button
        variant="outline"
        size="icon"
        onClick={toggleTheme}
        className="rounded-full h-10 w-10 overflow-hidden relative border-2 transition-colors bg-background hover:bg-accent"
      >
        <motion.div
          animate={{
            rotate: theme === "dark" ? 0 : 180,
            opacity: 1,
            scale: 1
          }}
          initial={{ 
            rotate: theme === "dark" ? -180 : 0,
            opacity: 0,
            scale: 0.5 
          }}
          transition={{ 
            duration: 0.5, 
            type: "spring", 
            stiffness: 200,
            damping: 15
          }}
          className="w-full h-full flex items-center justify-center absolute inset-0"
        >
          {theme === "dark" ? (
            <Moon className="h-5 w-5 text-yellow-300" />
          ) : (
            <Sun className="h-5 w-5 text-amber-500" />
          )}
        </motion.div>
        <span className="sr-only">Toggle theme</span>
      </Button>
    </motion.div>
  )
}